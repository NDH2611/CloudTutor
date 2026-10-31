"use strict";
const { getGeminiKey } = require("./geminiSecret");
const { describeFrame } = require("./geminiVision");
const { DynamoDBClient, GetItemCommand } = require("@aws-sdk/client-dynamodb");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
async function secretHealth() {
  await getGeminiKey();
  return { secret_access: true, secret_source: "SECRETS_MANAGER",
    model: process.env.GEMINI_MODEL, prompt_version: process.env.GEMINI_PROMPT_VERSION,
    environment_key_present: Boolean(process.env.GEMINI_API_KEY) };
}
async function frameCacheCheck(event) {
  const identity = { ownerId: event.owner_id, jobId: event.job_id,
    processingVersion: event.processing_version, frameKey: event.frame_key };
  for (const value of [identity.ownerId, identity.jobId, identity.processingVersion]) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("DIAGNOSTIC_IDENTITY_INVALID");
  }
  if (!identity.frameKey?.startsWith(`frames/${identity.ownerId}/${identity.jobId}/`)) throw new Error("DIAGNOSTIC_FRAME_MISMATCH");
  const db = new DynamoDBClient({ region: process.env.AWS_REGION || "ap-southeast-1" });
  const job = (await db.send(new GetItemCommand({ TableName: process.env.JOBS_TABLE || "ddb-cloudtutor-jobs",
    Key: { job_id: { S: identity.jobId } }, ConsistentRead: true }))).Item;
  if (job?.test_fixture?.BOOL !== true || job.owner_id?.S !== identity.ownerId ||
      job.processing_version?.S !== identity.processingVersion || job.status?.S !== "PROCESSING_VISION") {
    throw new Error("DIAGNOSTIC_REQUIRES_VISION_TEST_FIXTURE");
  }
  const s3 = new S3Client({ region: process.env.AWS_REGION || "ap-southeast-1" });
  const object = await s3.send(new GetObjectCommand({ Bucket: process.env.MEDIA_BUCKET, Key: identity.frameKey }));
  if (object.ContentLength > 4 * 1024 * 1024) throw new Error("DIAGNOSTIC_FRAME_TOO_LARGE");
  const bytes = await object.Body.transformToByteArray();
  const first = await describeFrame(bytes, identity);
  const second = await describeFrame(bytes, identity);
  return { secret_source: "SECRETS_MANAGER", first_cache_hit: first.cache_hit,
    second_cache_hit: second.cache_hit, useful: second.useful,
    usage: first.usage, model: process.env.GEMINI_MODEL };
}
module.exports = { secretHealth, frameCacheCheck };
