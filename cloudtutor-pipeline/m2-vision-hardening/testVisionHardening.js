"use strict";
const assert = require("node:assert/strict");
const Module = require("node:module");
const originalLoad = Module._load;
const sends = {};
const serviceFor = { "secrets-manager": "secret", dynamodb: "db", s3: "s3", sqs: "sqs" };
Module._load = function(name, parent, isMain) {
  const service = serviceFor[name.replace("@aws-sdk/client-", "")];
  if (name.startsWith("@aws-sdk/client-") && service) {
    return new Proxy({}, { get: (_target, field) => {
      if (String(field).endsWith("Client")) return class { async send(command) {
        if (!sends[service]) throw new Error(`UNMOCKED_${service}`);
        return sends[service](command);
      } };
      return class { constructor(input) { this.input = input; this.kind = String(field); } };
    } });
  }
  return originalLoad.apply(this, arguments);
};
process.env.GEMINI_SECRET_ID = "test-secret-id";
process.env.GEMINI_QUOTA_TABLE = "test-control-table";
process.env.GEMINI_MODEL = "test-model";
process.env.GEMINI_PROMPT_VERSION = "vision-v2";
process.env.MEDIA_BUCKET = "test-bucket";
process.env.VISION_ALLOWED_QUEUE_ARNS = "arn:aws:sqs:ap-southeast-1:251929332061:test-vision";
const fakeKey = "fake_key_for_tests_only_123456789";
const printed = [];
const realLog = console.log;
const realWarn = console.warn;
console.log = value => printed.push(String(value));
console.warn = value => printed.push(String(value));
const { parseKey, makeKeyReader } = require("./geminiSecret");
const { fetchGeminiWithRetry, errorInfo } = require("./geminiRetry");
const { VisionError } = require("./visionErrors");
const { cacheKey, readFrameCache } = require("./visionFrameCache");
const { describeFrame } = require("./geminiVision");
const { pauseQuota } = require("./visionQuota");
const { retryDecision, runVisionRecord } = require("./visionRuntime");
let tests = 0;
async function test(name, fn) { await fn(); tests++; realLog("PASS:", name); }
function response(status, payload = {}, retryAfter = null) {
  return { status, ok: status >= 200 && status < 300,
    headers: { get: () => retryAfter }, json: async () => payload };
}
const identity = { ownerId: "test-user", jobId: "job-1", processingVersion: "v-1", frameKey: "frames/test-user/job-1/source_frame.0000000.jpg" };
const job = { job_id: { S: "job-1" }, owner_id: { S: "test-user" }, processing_version: { S: "v-1" }, status: { S: "PROCESSING_VISION" } };
const message = { owner_id: "test-user", job_id: "job-1", processing_version: "v-1" };
const record = { receiptHandle: "test-receipt", eventSourceARN: process.env.VISION_ALLOWED_QUEUE_ARNS };

async function main() {
  await test("secret JSON api_key", () => assert.equal(parseKey(JSON.stringify({ api_key: fakeKey })), fakeKey));
  await test("secret raw-string compatibility", () => assert.equal(parseKey(fakeKey), fakeKey));
  await test("invalid secret does not include value in error", () => assert.throws(() => parseKey("{bad secret"), /GEMINI_SECRET_INVALID_JSON/));
  await test("coalesce concurrent secret reads", async () => {
    let calls = 0;
    const reader = makeKeyReader(async () => { calls++; return fakeKey; });
    const keys = await Promise.all(Array.from({ length: 20 }, () => reader()));
    assert.equal(calls, 1); assert.ok(keys.every(key => key === fakeKey));
  });
  await test("secret cache expires after 5 minutes", async () => {
    let now = 0, calls = 0;
    const reader = makeKeyReader(async () => { calls++; return fakeKey; }, () => now);
    await reader(); await reader(); now = 300001; await reader(); assert.equal(calls, 2);
  });
  await test("secret read failure is not cached", async () => {
    let calls = 0;
    const reader = makeKeyReader(async () => { if (++calls === 1) throw new Error("fake read error"); return fakeKey; });
    await assert.rejects(reader()); await reader(); assert.equal(calls, 2);
  });
  await test("429 -> 503 -> 200 backoff", async () => {
    let calls = 0; const waits = [];
    const result = await fetchGeminiWithRetry("https://example.invalid", {}, {
      fetchImpl: async () => [response(429), response(503), response(200)][calls++],
      sleep: async ms => waits.push(ms), random: () => 0,
    });
    assert.equal(result.status, 200); assert.equal(calls, 3); assert.deepEqual(waits, [1000, 2000]);
  });
  await test("403 is not retried", async () => {
    let calls = 0;
    assert.equal((await fetchGeminiWithRetry("x", {}, { fetchImpl: async () => { calls++; return response(403); } })).status, 403);
    assert.equal(calls, 1);
  });
  await test("503 stops after 3 requests", async () => {
    let calls = 0;
    await assert.rejects(fetchGeminiWithRetry("x", {}, { fetchImpl: async () => { calls++; return response(503); }, sleep: async () => {} }), error => error.retryable && error.code === "GEMINI_TEMPORARY_FAILURE");
    assert.equal(calls, 3);
  });
  await test("network error -> 200", async () => {
    let calls = 0;
    const result = await fetchGeminiWithRetry("x", {}, { fetchImpl: async () => { if (++calls === 1) throw new TypeError("mock"); return response(200); }, sleep: async () => {} });
    assert.equal(result.status, 200); assert.equal(calls, 2);
  });
  await test("timeout -> 200", async () => {
    let calls = 0;
    await fetchGeminiWithRetry("x", {}, { fetchImpl: async () => { if (++calls === 1) throw Object.assign(new Error(), { name: "TimeoutError" }); return response(200); }, sleep: async () => {} });
    assert.equal(calls, 2);
  });
  await test("daily quota stops immediately", async () => {
    let calls = 0, waits = 0;
    await assert.rejects(fetchGeminiWithRetry("x", {}, {
      fetchImpl: async () => { calls++; return response(429, { error: { details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProject" }] }] } }); },
      sleep: async () => { waits++; },
    }), error => error.daily && error.retrySeconds >= 21600);
    assert.equal(calls, 1); assert.equal(waits, 0);
  });
  await test("unknown 429 is not guessed to be daily quota", () => assert.equal(errorInfo({ error: { message: "quota exceeded" } }, null, 0).daily, false));
  await test("Google RetryInfo delay is honored", async () => {
    let calls = 0;
    await assert.rejects(fetchGeminiWithRetry("x", {}, { fetchImpl: async () => { calls++; return response(429, { error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "120s" }] } }); } }), error => error.retrySeconds >= 120);
    assert.equal(calls, 1);
  });
  await test("Retry-After long wait is deferred", async () => {
    await assert.rejects(fetchGeminiWithRetry("x", {}, { fetchImpl: async () => response(429, {}, "120") }), error => error.code === "GEMINI_RATE_LIMITED");
  });
  await test("frame cache key separates versions", () => assert.notEqual(cacheKey(Buffer.from("a"), identity), cacheKey(Buffer.from("a"), { ...identity, processingVersion: "v-2" })));
  await test("frame cache rejects cross-job frame", () => assert.throws(() => cacheKey(Buffer.from("a"), { ...identity, frameKey: "frames/other/job/frame.jpg" }), /VISION_CACHE_FRAME_MISMATCH/));
  await test("frame cache validates identity", async () => {
    sends.s3 = async () => ({ Body: { transformToString: async () => JSON.stringify({ job_id: "wrong" }) } });
    await assert.rejects(readFrameCache("key", identity), /VISION_FRAME_CACHE_INVALID/);
  });

  const objects = new Map();
  sends.secret = async () => ({ SecretString: JSON.stringify({ api_key: fakeKey }) });
  sends.db = async () => ({});
  sends.s3 = async command => {
    if (command.kind === "PutObjectCommand") { objects.set(command.input.Key, command.input.Body); return {}; }
    if (!objects.has(command.input.Key)) throw Object.assign(new Error(), { name: "NoSuchKey" });
    return { Body: { transformToString: async () => objects.get(command.input.Key) } };
  };
  let fetches = 0;
  global.fetch = async () => { fetches++; return response(200, {
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ useful: true, description: "Mock visual content" }) }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
  }); };
  await test("second frame read uses S3 cache, no API request", async () => {
    const first = await describeFrame(Buffer.from("mock-image"), identity);
    const second = await describeFrame(Buffer.from("mock-image"), identity);
    assert.equal(first.cache_hit, false); assert.equal(second.cache_hit, true); assert.equal(fetches, 1);
  });
  await test("non-useful frame is cached too", async () => {
    let calls = 0;
    global.fetch = async () => { calls++; return response(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"useful":false,"description":""}' }] } }] }); };
    await describeFrame(Buffer.from("black-image"), identity);
    const second = await describeFrame(Buffer.from("black-image"), identity);
    assert.equal(second.cache_hit, true); assert.equal(second.useful, false); assert.equal(calls, 1);
  });
  await test("invalid output is not accepted", async () => {
    global.fetch = async () => response(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "invalid JSON" }] } }] });
    await assert.rejects(describeFrame(Buffer.from("bad-output"), identity), error => error.code === "GEMINI_OUTPUT_INVALID");
  });
  await test("HTTP 403 is a permanent Vision error", async () => {
    global.fetch = async () => response(403);
    await assert.rejects(describeFrame(Buffer.from("forbidden"), identity), error => error.status === 403 && !error.retryable);
  });
  await test("shared quota pauses are persisted", async () => {
    const updates = [];
    sends.db = async command => { updates.push(command); return {}; };
    await pauseQuota(new VisionError("GEMINI_RATE_LIMITED", { status: 429, retryable: true, retrySeconds: 900 }));
    assert.equal(updates.length, 1); assert.equal(updates[0].kind, "UpdateItemCommand");
    assert.ok(updates[0].input.ExpressionAttributeValues[":next"].N);
  });
  await test("API retry limit becomes terminal after 3 rounds", () => {
    const decision = retryDecision({ ...job, vision_retry_version: { S: "v-1" }, vision_retry_attempts: { N: "2" } }, new VisionError("mock", { retryable: true }));
    assert.equal(decision.attempts, 3); assert.equal(decision.terminal, true);
  });
  await test("cooldown does not consume an API attempt", () => assert.equal(retryDecision(job, new VisionError("cooldown", { retryable: true, attempted: false })).attempts, 0));
  await test("retry attempt budget resets for a new version", () => assert.equal(retryDecision({ ...job, vision_retry_version: { S: "old" }, vision_retry_attempts: { N: "3" } }, new VisionError("mock", { retryable: true })).attempts, 1));
  await test("stale owner/version never runs action", async () => {
    sends.db = async () => ({ Item: { ...job, owner_id: { S: "other" } } });
    let called = false;
    const result = await runVisionRecord({ record, message }, async () => { called = true; });
    assert.equal(result.reason, "STALE_MESSAGE"); assert.equal(called, false);
  });
  await test("deleted_at blocks Vision", async () => {
    sends.db = async () => ({ Item: { ...job, deleted_at: { S: "2026-01-01" } } });
    const result = await runVisionRecord({ record, message }, async () => assert.fail());
    assert.equal(result.reason, "JOB_DELETED");
  });
  await test("PENDING AI recovery bypasses Vision lease and API cooldown", async () => {
    sends.db = async command => { assert.equal(command.kind, "GetItemCommand"); return { Item: { ...job, status: { S: "PROCESSING_AI" } } }; };
    assert.equal(await runVisionRecord({ record, message }, async () => "RECOVERED"), "RECOVERED");
  });
  await test("job cooldown defers SQS visibility without executing", async () => {
    sends.db = async () => ({ Item: { ...job, vision_retry_version: { S: "v-1" }, vision_retry_state: { S: "WAITING" }, next_retry_at: { N: String(Math.floor(Date.now() / 1000) + 900) } } });
    let changed = false;
    sends.sqs = async command => { changed = true; assert.equal(command.kind, "ChangeMessageVisibilityCommand"); assert.ok(command.input.VisibilityTimeout <= 900); return {}; };
    await assert.rejects(runVisionRecord({ record, message }, async () => assert.fail()), /VISION_NOT_DUE/);
    assert.equal(changed, true);
  });
  await test("busy lease never executes Gemini action", async () => {
    sends.db = async command => {
      if (command.kind === "GetItemCommand") return { Item: job };
      throw Object.assign(new Error(), { name: "ConditionalCheckFailedException" });
    };
    await assert.rejects(runVisionRecord({ record, message }, async () => assert.fail()), /VISION_LEASE_BUSY_OR_JOB_CHANGED/);
  });
  await test("quota failure saves WAITING checkpoint and preserves message", async () => {
    const updates = [];
    sends.db = async command => { if (command.kind === "GetItemCommand") return { Item: job }; updates.push(command.input); return {}; };
    sends.sqs = async () => ({});
    await assert.rejects(runVisionRecord({ record, message }, async () => { throw new VisionError("GEMINI_DAILY_QUOTA", { retryable: true, status: 429, retrySeconds: 21600 }); }), /GEMINI_DAILY_QUOTA/);
    assert.ok(updates.some(input => input.ExpressionAttributeValues?.[":state"]?.S === "WAITING"));
    assert.ok(updates.some(input => input.UpdateExpression === "REMOVE #l, #t"));
  });
  await test("permanent HTTP failure marks FAILED and acknowledges", async () => {
    const updates = [];
    sends.db = async command => { if (command.kind === "GetItemCommand") return { Item: job }; updates.push(command.input); return {}; };
    const result = await runVisionRecord({ record, message }, async () => { throw new VisionError("GEMINI_HTTP_PERMANENT", { status: 403 }); });
    assert.equal(result.reason, "VISION_GEMINI_HTTP_403");
    assert.ok(updates.some(input => input.ExpressionAttributeValues?.[":failed"]?.S === "FAILED"));
  });
  await test("EMF metrics have bounded dimensions", () => {
    const metrics = printed.map(line => { try { return JSON.parse(line); } catch { return {}; } }).filter(item => item._aws);
    assert.ok(metrics.length > 0);
    for (const item of metrics) assert.deepEqual(item._aws.CloudWatchMetrics[0].Dimensions, [["FunctionName", "Model"]]);
  });
  await test("logs never contain the secret value", () => assert.ok(printed.every(line => !line.includes(fakeKey))));
  realLog(`PASS: ${tests} Vision hardening checks; no real AWS/Gemini requests.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { console.log = realLog; console.warn = realWarn; Module._load = originalLoad; });
