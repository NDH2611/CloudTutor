"use strict";
const { createHash } = require("node:crypto");
const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require("@aws-sdk/client-dynamodb");
const { VisionError } = require("./visionErrors");
const db = new DynamoDBClient({ region: process.env.AWS_REGION || "ap-southeast-1" });
function quotaKey() {
  if (!process.env.GEMINI_QUOTA_TABLE || !process.env.GEMINI_SECRET_ID) throw new Error("VISION_QUOTA_CONFIG_MISSING");
  return { control_key: { S: createHash("sha256").update(
    `${process.env.GEMINI_SECRET_ID}|${process.env.GEMINI_MODEL || "gemini-3.5-flash-lite"}`
  ).digest("hex") } };
}
async function checkQuota() {
  const result = await db.send(new GetItemCommand({
    TableName: process.env.GEMINI_QUOTA_TABLE, Key: quotaKey(), ConsistentRead: true,
  }));
  const next = Number(result.Item?.next_retry_at?.N || 0);
  const now = Math.floor(Date.now() / 1000);
  if (next > now) throw new VisionError("GEMINI_SHARED_COOLDOWN", {
    retryable: true, attempted: false, retrySeconds: next - now,
  });
}
async function pauseQuota(error) {
  if (error.status !== 429) return;
  const next = Math.floor(Date.now() / 1000) + Math.max(1, error.retrySeconds);
  try {
    await db.send(new UpdateItemCommand({
      TableName: process.env.GEMINI_QUOTA_TABLE, Key: quotaKey(),
      ConditionExpression: "attribute_not_exists(#n) OR #n < :next",
      UpdateExpression: "SET #n = :next, #e = :expiry, #r = :reason",
      ExpressionAttributeNames: { "#n": "next_retry_at", "#e": "expires_at", "#r": "reason" },
      ExpressionAttributeValues: { ":next": { N: String(next) }, ":expiry": { N: String(next + 86400) }, ":reason": { S: error.code } },
    }));
  } catch (failure) { if (failure.name !== "ConditionalCheckFailedException") throw failure; }
}
module.exports = { checkQuota, pauseQuota };
