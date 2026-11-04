"use strict";
const assert = require("node:assert/strict"), Module = require("node:module");
const original = Module._load;
let s3Send;
class Command { constructor(input) { this.input = input; } }
class HeadObjectCommand extends Command {}
class GetObjectCommand extends Command {}
class UpdateItemCommand extends Command {}
Module._load = function (name) {
  if (name === "@aws-sdk/client-s3") return { S3Client: class { send(c) { return s3Send(c); } }, HeadObjectCommand, GetObjectCommand };
  if (name === "@aws-sdk/client-dynamodb") return { UpdateItemCommand };
  return original.apply(this, arguments);
};
const { validateVideoInput, inspectMp4Header, MAX_VIDEO_BYTES } = require("./validateVideoInput");
const { guardInitialVideo } = require("./workerInputGuard");
const { buildFrameText, selectOcrLines } = require("./ocrText");
const { score } = require("./ocrEvaluation");
let passed = 0;
async function check(name, action) { await action(); passed++; console.log("PASS: " + name); }
function header(brand = "isom") { const b = Buffer.alloc(24); b.writeUInt32BE(24); b.write("ftyp", 4); b.write(brand, 8); b.write("isom", 16); b.write("mp42", 20); return b; }
function setup({ size = 100, bytes = header(), etag = '"abc"', fail } = {}) {
  const calls = [];
  s3Send = async c => { calls.push(c); if (fail) throw fail;
    if (c instanceof HeadObjectCommand) return { ContentLength: size, ETag: etag, VersionId: "v1", ContentType: "application/octet-stream" };
    return { Body: { transformToByteArray: async () => bytes } };
  };
  return calls;
}
const input = { bucket: "test", key: "videos/u/j/source.mp4" };
(async () => {
  await check("valid ftyp accepted", () => assert.equal(inspectMp4Header(header()).major_brand, "isom"));
  await check("QuickTime rejected", () => assert.throws(() => inspectMp4Header(header("qt  ")), /VIDEO_INVALID/));
  await check("3GP rejected", () => assert.throws(() => inspectMp4Header(header("3gp5")), /VIDEO_INVALID/));
  await check("renamed arbitrary file rejected", () => assert.throws(() => inspectMp4Header(Buffer.from("not a movie ftyp isom")), /VIDEO_INVALID/));
  await check("truncated ftyp rejected", () => assert.throws(() => inspectMp4Header(header().subarray(0, 18)), /VIDEO_INVALID/));
  await check("invalid size box rejected", () => { const b = header(); b.writeUInt32BE(4); assert.throws(() => inspectMp4Header(b), /VIDEO_INVALID/); });
  await check("padding box allowed", () => { const pad = Buffer.alloc(8); pad.writeUInt32BE(8); pad.write("free", 4); assert.equal(inspectMp4Header(Buffer.concat([pad, header()])).major_brand, "isom"); });
  await check("500 MB boundary accepted using mock metadata", async () => { setup({ size: MAX_VIDEO_BYTES }); assert.equal((await validateVideoInput(input)).content_length, 500000000); });
  await check("500 MB + 1 rejected without downloading object", async () => { const calls = setup({ size: MAX_VIDEO_BYTES + 1 }); await assert.rejects(validateVideoInput(input), /VIDEO_TOO_LARGE/); assert.equal(calls.length, 1); });
  await check("empty object rejected", async () => { setup({ size: 0 }); await assert.rejects(validateVideoInput(input), /VIDEO_EMPTY/); });
  await check("non-integer size rejected", async () => { setup({ size: NaN }); await assert.rejects(validateVideoInput(input), /VIDEO_EMPTY/); });
  await check("non-MP4 extension rejected before S3", async () => { const c = setup(); await assert.rejects(validateVideoInput({ ...input, key: "x.txt" }), /VIDEO_EXTENSION/); assert.equal(c.length, 0); });
  await check("ContentType is not trusted as proof of format", async () => { setup(); assert.equal((await validateVideoInput(input)).container_check, "FTYP_ONLY"); });
  await check("stale event ETag skipped", async () => { const calls = setup(); assert.equal((await validateVideoInput({ ...input, eventEtag: "old" })).skipped, true); assert.equal(calls.length, 1); });
  await check("stale S3 version skipped", async () => { setup(); assert.equal((await validateVideoInput({ ...input, eventVersionId: "v0" })).skipped, true); });
  await check("range is bounded and uses IfMatch", async () => { const c = setup({ size: 100000 }); await validateVideoInput({ ...input, eventEtag: "abc" }); assert.equal(c[1].input.Range, "bytes=0-65535"); assert.equal(c[1].input.IfMatch, '"abc"'); });
  await check("S3 permissions error remains retryable", async () => { const e = new Error("ACCESS_DENIED"); setup({ fail: e }); await assert.rejects(validateVideoInput(input), /ACCESS_DENIED/); });
  await check("oversize response rejected", async () => { setup({ bytes: Buffer.alloc(65537) }); await assert.rejects(validateVideoInput(input), /S3_HEADER_READ_INVALID/); });
  await check("invalid input writes conditional FAILED", async () => { setup({ size: 0 }); let update; const r = await guardInitialVideo({ ...input, videoKey: input.key, jobId: "j", ownerId: "u", jobsTable: "jobs", dynamodb: { send: async c => { update = c.input; } } }); assert.equal(r.reason, "VIDEO_EMPTY_OR_INVALID_SIZE"); assert.match(update.ConditionExpression, /attribute_not_exists\(#version\)/); assert.match(update.ConditionExpression, /#deleted/); });
  await check("concurrent job change never overwritten", async () => { setup({ size: 0 }); const r = await guardInitialVideo({ ...input, videoKey: input.key, dynamodb: { send: async () => { const e = new Error(); e.name = "ConditionalCheckFailedException"; throw e; } } }); assert.equal(r.reason, "INPUT_REJECTION_CONCURRENT_JOB_CHANGE"); });
  await check("Unicode composed and decomposed deduplicate", () => assert.equal(buildFrameText([{ DetectedText: "Tiếng Việt" }, { DetectedText: "Tiếng Việt".normalize("NFD") }]), "Tiếng Việt"));
  await check("accented and unaccented lines remain different", () => assert.equal(buildFrameText([{ DetectedText: "ma" }, { DetectedText: "má" }]), "ma\nmá"));
  await check("confidence threshold remains 80", () => { const d = c => ({ Type: "LINE", Confidence: c, Geometry: { BoundingBox: { Top: 0, Left: 0 } } }); assert.equal(selectOcrLines([d(79.9), d(80)]).length, 1); });
  await check("CER retains accent errors", () => assert.equal(score("má", "ma").cer, 0.5));
  await check("WER measures insertion deletion substitution", () => assert.equal(score("a b c", "a d").wer, 2 / 3));
  await check("blank probe flags hallucinated OCR", () => { assert.equal(score("", "noise").blank_false_positive, true); assert.equal(score("", "noise").cer, null); });
  console.log(`PASS: ${passed} input/OCR checks. Size boundaries use mocks; no 500 MB upload or AWS call.`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { Module._load = original; });
