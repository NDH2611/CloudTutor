"use strict";
const { createHash } = require("node:crypto");
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const s3 = new S3Client({ region: process.env.AWS_REGION || "ap-southeast-1" });
function cacheKey(bytes, identity) {
  if (!identity?.jobId || !identity?.ownerId || !identity?.processingVersion || !identity?.frameKey) return null;
  for (const value of [identity.jobId, identity.ownerId, identity.processingVersion]) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("VISION_CACHE_IDENTITY_INVALID");
  }
  if (!identity.frameKey.startsWith(`frames/${identity.ownerId}/${identity.jobId}/`)) throw new Error("VISION_CACHE_FRAME_MISMATCH");
  const digest = createHash("sha256").update(bytes).update(identity.frameKey)
    .update(process.env.GEMINI_MODEL || "gemini-3.5-flash-lite")
    .update(process.env.GEMINI_PROMPT_VERSION || "vision-v2").digest("hex");
  return `results/${identity.ownerId}/${identity.jobId}/vision-frames-v${identity.processingVersion}/${digest}.json`;
}
function validate(record, identity) {
  if (record.job_id !== identity.jobId || record.owner_id !== identity.ownerId ||
      record.processing_version !== identity.processingVersion || record.frame_key !== identity.frameKey ||
      record.model !== (process.env.GEMINI_MODEL || "gemini-3.5-flash-lite") ||
      record.prompt_version !== (process.env.GEMINI_PROMPT_VERSION || "vision-v2") ||
      typeof record.result?.useful !== "boolean" || typeof record.result?.text !== "string" ||
      (record.result.useful && !record.result.text.trim())) throw new Error("VISION_FRAME_CACHE_INVALID");
  return record.result;
}
async function readFrameCache(key, identity) {
  if (!key) return null;
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: process.env.MEDIA_BUCKET, Key: key }));
    if (result.ContentLength > 262144) throw new Error("VISION_FRAME_CACHE_TOO_LARGE");
    const body = await result.Body.transformToString("utf8");
    if (Buffer.byteLength(body) > 262144) throw new Error("VISION_FRAME_CACHE_TOO_LARGE");
    return validate(JSON.parse(body), identity);
  } catch (error) {
    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}
async function writeFrameCache(key, identity, result) {
  if (!key) return result;
  const record = { job_id: identity.jobId, owner_id: identity.ownerId,
    processing_version: identity.processingVersion, frame_key: identity.frameKey,
    model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    prompt_version: process.env.GEMINI_PROMPT_VERSION || "vision-v2", result };
  try {
    await s3.send(new PutObjectCommand({ Bucket: process.env.MEDIA_BUCKET, Key: key,
      ContentType: "application/json", Body: JSON.stringify(record), IfNoneMatch: "*" }));
    return result;
  } catch (error) {
    if (error.name !== "PreconditionFailed" && error.$metadata?.httpStatusCode !== 412) throw error;
    const existing = await readFrameCache(key, identity);
    if (!existing) throw new Error("VISION_FRAME_CACHE_WINNER_MISSING");
    return existing;
  }
}
module.exports = { cacheKey, readFrameCache, writeFrameCache };
