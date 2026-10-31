"use strict";
const assert = require("node:assert/strict"), Module = require("node:module");
const original = Module._load;
class C { constructor(input) { this.input = input; } }
class GetItemCommand extends C {} class UpdateItemCommand extends C {}
class HeadObjectCommand extends C {} class GetObjectCommand extends C {}
class StartTranscriptionJobCommand extends C {} class GetTranscriptionJobCommand extends C {}
let job, size, bytes, calls, etag;
Module._load = function (name) {
  if (name === "@aws-sdk/client-dynamodb") return { GetItemCommand, UpdateItemCommand,
    DynamoDBClient: class { async send(c) { calls.push(c); return c instanceof GetItemCommand ? { Item: job } : {}; } } };
  if (name === "@aws-sdk/client-s3") return { HeadObjectCommand, GetObjectCommand,
    S3Client: class { async send(c) { calls.push(c); return c instanceof HeadObjectCommand ? { ContentLength: size, ETag: etag } : { Body: { transformToByteArray: async () => bytes } }; } } };
  if (name === "@aws-sdk/client-transcribe") return { StartTranscriptionJobCommand, GetTranscriptionJobCommand,
    TranscribeClient: class { async send(c) { calls.push(c); return {}; } } };
  return original.apply(this, arguments);
};
process.env.MEDIA_BUCKET = "test";
delete process.env.INPUT_VIDEO_PREFIX;
const { handler } = require("./index");
const videoKey = "videos/u/j/source.mp4";
const event = { Records: [{ body: JSON.stringify({ Records: [{ s3: { bucket: { name: "test" }, object: { key: videoKey, eTag: "abc" } } }] }) }] };
const count = T => calls.filter(c => c instanceof T).length;
function reset() { calls = []; size = 100; etag = '"abc"'; bytes = Buffer.alloc(24); bytes.writeUInt32BE(24); bytes.write("ftyp", 4); bytes.write("isom", 8); bytes.write("mp42", 16); bytes.write("isom", 20);
  job = { job_id: { S: "j" }, owner_id: { S: "u" }, video_key: { S: videoKey }, status: { S: "UPLOADED" } }; }
let passed = 0;
async function test(name, f) { reset(); await f(); console.log("PASS: " + name); passed++; }
(async () => {
  await test("worker valid object validates before Transcribe", async () => { await handler(event); assert.equal(count(StartTranscriptionJobCommand), 1); const u = calls.find(c => c instanceof UpdateItemCommand).input; assert.equal(JSON.parse(u.ExpressionAttributeValues[":input"].S).content_length, 100); assert.ok(calls.findIndex(c => c instanceof GetObjectCommand) < calls.findIndex(c => c instanceof UpdateItemCommand)); });
  await test("worker rejects invalid header without Transcribe", async () => { bytes = Buffer.from("not mp4"); await handler(event); assert.equal(count(StartTranscriptionJobCommand), 0); assert.equal(calls.find(c => c instanceof UpdateItemCommand).input.ExpressionAttributeValues[":error"].S, "VIDEO_INVALID_MP4_HEADER"); });
  await test("worker rejects oversized object without range read or service job", async () => { size = 500000001; await handler(event); assert.equal(count(GetObjectCommand), 0); assert.equal(count(StartTranscriptionJobCommand), 0); });
  await test("worker rejects owner mismatch before S3", async () => { job.owner_id.S = "other"; await assert.rejects(handler(event), /Owner/); assert.equal(count(HeadObjectCommand), 0); assert.equal(count(UpdateItemCommand), 0); });
  await test("worker tombstone skips all external work", async () => { job.deleted_at = { S: "2026-10-31T00:00:00Z" }; await handler(event); assert.equal(count(HeadObjectCommand), 0); assert.equal(count(StartTranscriptionJobCommand), 0); });
  await test("worker advanced job is not revalidated or restarted", async () => { job.status.S = "PROCESSING_AI"; await handler(event); assert.equal(count(HeadObjectCommand), 0); assert.equal(count(StartTranscriptionJobCommand), 0); });
  await test("worker stale object event leaves job untouched", async () => { etag = '"new-object"'; await handler(event); assert.equal(count(UpdateItemCommand), 0); assert.equal(count(StartTranscriptionJobCommand), 0); });
  await test("worker resumes existing ASR version without replacing checkpoint", async () => { job.status.S = "PROCESSING_ASR"; job.processing_version = { S: "v1" }; job.transcription_job_name = { S: "existing-name" }; await handler(event); assert.equal(count(UpdateItemCommand), 0); assert.equal(calls.find(c => c instanceof StartTranscriptionJobCommand).input.TranscriptionJobName, "existing-name"); });
  console.log(`PASS: ${passed} actual Worker handler checks; mocked AWS clients.`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { Module._load = original; });
