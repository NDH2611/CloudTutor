"use strict";
const { randomUUID } = require("node:crypto");
const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require("@aws-sdk/client-dynamodb");
const { SQSClient, ChangeMessageVisibilityCommand } = require("@aws-sdk/client-sqs");
const { VisionError } = require("./visionErrors");
const { metric } = require("./visionMetrics");
const db = new DynamoDBClient({ region: process.env.AWS_REGION || "ap-southeast-1" });
const sqs = new SQSClient({ region: process.env.AWS_REGION || "ap-southeast-1" });
const table = process.env.JOBS_TABLE || "ddb-cloudtutor-jobs";

function retryDecision(job, error, now = Math.floor(Date.now() / 1000)) {
  const previous = job.vision_retry_version?.S === job.processing_version?.S
    ? Number(job.vision_retry_attempts?.N || 0) : 0;
  const attempts = previous + (error.attempted ? 1 : 0);
  return {
    attempts, terminal: !error.retryable || attempts >= 3,
    next: now + Math.max(30, Math.ceil(error.retrySeconds)),
    code: error.retryable ? "VISION_GEMINI_RETRIES_EXHAUSTED" : `VISION_GEMINI_HTTP_${error.status || "ERROR"}`,
  };
}
async function deferVisibility(record, seconds) {
  if (!record.receiptHandle || !record.eventSourceARN) return;
  const allowed = (process.env.VISION_ALLOWED_QUEUE_ARNS || "").split(",");
  if (!allowed.includes(record.eventSourceARN)) throw new Error("VISION_QUEUE_ARN_NOT_ALLOWED");
  const parts = record.eventSourceARN.split(":");
  if (parts.length !== 6 || parts[2] !== "sqs" || parts[3] !== "ap-southeast-1" || parts[4] !== "251929332061") {
    throw new Error("VISION_QUEUE_IDENTITY_INVALID");
  }
  await sqs.send(new ChangeMessageVisibilityCommand({
    QueueUrl: `https://sqs.${parts[3]}.amazonaws.com/${parts[4]}/${parts[5]}`,
    ReceiptHandle: record.receiptHandle,
    VisibilityTimeout: Math.min(43200, Math.max(1, Math.ceil(seconds))),
  }));
}
async function runVisionRecord({ record, message }, action) {
  const { owner_id: owner, job_id: id, processing_version: version } = message || {};
  for (const value of [owner, id, version]) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("VISION_MESSAGE_IDENTITY_INVALID");
  }
  const key = { job_id: { S: id } };
  const read = await db.send(new GetItemCommand({ TableName: table, Key: key, ConsistentRead: true }));
  const job = read.Item;
  if (!job) return { skipped: true, reason: "JOB_NOT_FOUND", job_id: id };
  if (job.owner_id?.S !== owner || job.processing_version?.S !== version) {
    return { skipped: true, reason: "STALE_MESSAGE", job_id: id };
  }
  if (["DELETING", "DELETED"].includes(job.status?.S) || job.deleted_at?.S || job.deleted_at?.N) {
    return { skipped: true, reason: "JOB_DELETED", job_id: id };
  }
  // Không chặn phục hồi checkpoint đã chuyển sang PROCESSING_AI.
  if (job.status?.S !== "PROCESSING_VISION") return action();
  const now = Math.floor(Date.now() / 1000);
  const next = Number(job.next_retry_at?.N || 0);
  if (job.vision_retry_version?.S === version && job.vision_retry_state?.S === "WAITING" && next > now) {
    metric("DeferredJobs");
    await deferVisibility(record, next - now);
    throw new VisionError("VISION_NOT_DUE", { retryable: true, attempted: false, retrySeconds: next - now });
  }

  const token = randomUUID();
  const names = { "#o": "owner_id", "#v": "processing_version", "#s": "status", "#d": "deleted_at", "#l": "vision_lease_until", "#t": "vision_lease_token" };
  const values = { ":o": { S: owner }, ":v": { S: version }, ":s": { S: "PROCESSING_VISION" },
    ":empty": { S: "" }, ":null": { S: "NULL" }, ":now": { N: String(now) },
    ":expiry": { N: String(now + 360) }, ":token": { S: token } };
  try {
    await db.send(new UpdateItemCommand({ TableName: table, Key: key,
      ConditionExpression: "#o = :o AND #v = :v AND #s = :s " +
        "AND (attribute_not_exists(#d) OR attribute_type(#d, :null) OR #d = :empty) " +
        "AND (attribute_not_exists(#l) OR #l < :now)",
      UpdateExpression: "SET #l = :expiry, #t = :token",
      ExpressionAttributeNames: names, ExpressionAttributeValues: values,
    }));
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") throw new Error("VISION_LEASE_BUSY_OR_JOB_CHANGED");
    throw error;
  }

  try {
    const result = await action();
    // Chỉ bỏ trạng thái chờ retry nếu handler đã chuyển sang AI hoặc FAILED.
    try {
      await db.send(new UpdateItemCommand({ TableName: table, Key: key,
        ConditionExpression: "#o = :o AND #v = :v AND #s IN (:ai, :failed)",
        UpdateExpression: "REMOVE #r, #n",
        ExpressionAttributeNames: { "#o": "owner_id", "#v": "processing_version", "#s": "status", "#r": "vision_retry_state", "#n": "next_retry_at" },
        ExpressionAttributeValues: { ":o": { S: owner }, ":v": { S: version }, ":ai": { S: "PROCESSING_AI" }, ":failed": { S: "FAILED" } },
      }));
    } catch (error) { if (error.name !== "ConditionalCheckFailedException") throw error; }
    return result;
  } catch (error) {
    if (!(error instanceof VisionError)) throw error;
    const decision = retryDecision(job, error);
    const updateNames = {
      "#o": "owner_id", "#v": "processing_version", "#s": "status", "#t": "vision_lease_token",
      "#rv": "vision_retry_version", "#a": "vision_retry_attempts", "#r": "vision_retry_state",
      "#n": "next_retry_at", "#reason": "vision_retry_reason", "#u": "updated_at",
      "#deleted": "deleted_at",
    };
    const updateValues = {
      ":o": { S: owner }, ":v": { S: version }, ":s": { S: "PROCESSING_VISION" }, ":token": { S: token },
      ":attempts": { N: String(decision.attempts) }, ":reason": { S: error.code },
      ":now": { S: new Date().toISOString() },
      ":empty": { S: "" }, ":null": { S: "NULL" },
    };
    let expression = "SET #rv = :v, #a = :attempts, #reason = :reason, #u = :now, #r = :state";
    if (decision.terminal) {
      updateNames["#error"] = "error_code";
      updateValues[":failed"] = { S: "FAILED" };
      updateValues[":error"] = { S: decision.code };
      updateValues[":state"] = { S: "TERMINAL" };
      expression += ", #s = :failed, #error = :error REMOVE #n";
    } else {
      updateValues[":state"] = { S: "WAITING" };
      updateValues[":next"] = { N: String(decision.next) };
      expression += ", #n = :next";
    }
    try {
      await db.send(new UpdateItemCommand({ TableName: table, Key: key,
        ConditionExpression: "#o = :o AND #v = :v AND #s = :s AND #t = :token " +
          "AND (attribute_not_exists(#deleted) OR attribute_type(#deleted, :null) OR #deleted = :empty)",
        UpdateExpression: expression,
        ExpressionAttributeNames: updateNames, ExpressionAttributeValues: updateValues,
      }));
    } catch (failure) {
      if (failure.name === "ConditionalCheckFailedException") throw new Error("VISION_RETRY_JOB_CHANGED");
      throw failure;
    }
    if (decision.terminal) {
      metric("TerminalFailures");
      return { skipped: true, reason: decision.code, job_id: id };
    }
    metric("DeferredJobs");
    console.warn(JSON.stringify({ event: "VISION_RETRY_SCHEDULED", job_id: id,
      processing_version: version, reason: error.code, attempts: decision.attempts, next_retry_at: decision.next }));
    await deferVisibility(record, decision.next - Math.floor(Date.now() / 1000));
    // Ném lỗi để event source mapping không xóa message đang chờ.
    throw error;
  } finally {
    try {
      await db.send(new UpdateItemCommand({ TableName: table, Key: key,
        ConditionExpression: "#t = :token", UpdateExpression: "REMOVE #l, #t",
        ExpressionAttributeNames: { "#l": "vision_lease_until", "#t": "vision_lease_token" },
        ExpressionAttributeValues: { ":token": { S: token } },
      }));
    } catch (error) { if (error.name !== "ConditionalCheckFailedException") throw error; }
  }
}
module.exports = { runVisionRecord, retryDecision, deferVisibility };
