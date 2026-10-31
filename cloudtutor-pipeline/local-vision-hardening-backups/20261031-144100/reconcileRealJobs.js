"use strict";
const { randomUUID } = require("node:crypto");
const { DynamoDBClient, ScanCommand, GetItemCommand, UpdateItemCommand } = require("@aws-sdk/client-dynamodb");
const { TranscribeClient, GetTranscriptionJobCommand } = require("@aws-sdk/client-transcribe");
const { MediaConvertClient, GetJobCommand } = require("@aws-sdk/client-mediaconvert");
const { S3Client, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const rules = require("./recoveryRules");

const region = process.env.AWS_REGION || "ap-southeast-1";
const db = new DynamoDBClient({ region });
const transcribe = new TranscribeClient({ region });
const media = new MediaConvertClient({ region });
const s3 = new S3Client({ region });
// Không để SDK tự lặp một lệnh invoke có kết quả không rõ.
const lambda = new LambdaClient({ region, maxAttempts: 1 });
const jobsTable = "ddb-cloudtutor-jobs";
const bucket = "s3-cloudtutor-media-251929332061";
const targets = {
  ASR: "lambda-cloudtutor-transcription-completed",
  OCR: "lambda-cloudtutor-process-frames",
  VISION: "lambda-cloudtutor-vision-fallback",
};
const plain = item => item && Object.fromEntries(Object.entries(item).map(([key, value]) => [
  key, value.S ?? (value.N !== undefined ? Number(value.N) : value.BOOL),
]));
async function read(table, id) {
  const response = await db.send(new GetItemCommand({
    TableName: table, Key: { job_id: { S: id } }, ConsistentRead: true,
  }));
  return plain(response.Item);
}
async function plan(job) {
  let checkpoint;
  if (job.status === "PROCESSING_AI") {
    checkpoint = rules.pendingSource(job, await read("ddb-cloudtutor-results", job.job_id));
    if (checkpoint.action === "SKIP_SENT") return checkpoint;
  }
  const source = checkpoint?.source || (job.status === "PROCESSING_ASR" ? "ASR" : "OCR");
  let event;
  if (source === "ASR") {
    if (!job.transcription_job_name) throw Object.assign(new Error(), { code: "REVIEW_MISSING_ASR_ID" });
    const response = await transcribe.send(new GetTranscriptionJobCommand({
      TranscriptionJobName: job.transcription_job_name,
    }));
    event = rules.asrEvent(job, response.TranscriptionJob || {}, bucket);
  } else if (source === "OCR") {
    if (!job.ocr_mediaconvert_job_id) throw Object.assign(new Error(), { code: "REVIEW_MISSING_OCR_ID" });
    const response = await media.send(new GetJobCommand({ Id: job.ocr_mediaconvert_job_id }));
    const service = response.Job || {};
    let files = [];
    // Chỉ cần dữ liệu output để phát lại COMPLETE chưa có checkpoint.
    if (!checkpoint && service.Status === "COMPLETE") {
      const listed = await s3.send(new ListObjectsV2Command({
        Bucket: bucket, Prefix: `derived/${job.owner_id}/${job.job_id}/`, MaxKeys: 1000,
      }));
      if (listed.IsTruncated) throw Object.assign(new Error(), { code: "REVIEW_TOO_MANY_DERIVED_FILES" });
      files = (listed.Contents || []).map(item => item.Key);
    }
    event = rules.mediaEvent(job, service, bucket, files, Boolean(checkpoint));
  } else {
    // Handler Vision khôi phục checkpoint trước bước chọn frame/gọi Gemini.
    event = { Records: [{
      messageId: `reconcile-${randomUUID()}`, eventSource: "aws:sqs",
      body: JSON.stringify({ owner_id: job.owner_id, job_id: job.job_id,
        processing_version: job.processing_version }),
    }] };
  }
  return {
    action: checkpoint ? "RECOVER_PENDING" : `REPLAY_${source}_TERMINAL`,
    source, field: checkpoint?.field, target: targets[source], event,
  };
}
async function claim(job, proposal) {
  const now = Math.floor(Date.now() / 1000);
  const token = randomUUID();
  const attempts = job.real_recovery_version === job.processing_version
    ? Number(job.real_recovery_attempts || 0) + 1 : 1;
  const names = {
    "#s": "status", "#o": "owner_id", "#v": "processing_version", "#u": "updated_at",
    "#l": "real_recovery_lease_until", "#t": "real_recovery_token",
    "#rv": "real_recovery_version", "#n": "real_recovery_next_at", "#a": "real_recovery_attempts",
  };
  const values = {
    ":s": { S: job.status }, ":o": { S: job.owner_id }, ":v": { S: job.processing_version },
    ":u": { S: job.updated_at }, ":now": { N: String(now) }, ":max": { N: "3" },
    ":expiry": { N: String(now + 480) }, ":token": { S: token },
    ":next": { N: String(now + 900) }, ":attempts": { N: String(attempts) },
  };
  let condition = "#s = :s AND #o = :o AND #v = :v AND #u = :u " +
    "AND (attribute_not_exists(#l) OR #l < :now) " +
    "AND (attribute_not_exists(#rv) OR #rv <> :v OR " +
    "((attribute_not_exists(#n) OR #n <= :now) AND (attribute_not_exists(#a) OR #a < :max)))";
  if (proposal.field) {
    names["#h"] = proposal.field;
    values[":pending"] = { S: "PENDING" };
    condition += " AND #h = :pending";
  }
  if (job.test_fixture === true) {
    names["#fixture"] = "test_fixture"; values[":yes"] = { BOOL: true };
    condition += " AND #fixture = :yes";
  } else {
    names["#fixture"] = "test_fixture"; values[":yes"] = { BOOL: true };
    condition += " AND (attribute_not_exists(#fixture) OR #fixture <> :yes)";
  }
  await db.send(new UpdateItemCommand({
    TableName: jobsTable, Key: { job_id: { S: job.job_id } },
    ConditionExpression: condition,
    UpdateExpression: "SET #l = :expiry, #t = :token, #rv = :v, #n = :next, #a = :attempts",
    ExpressionAttributeNames: names, ExpressionAttributeValues: values,
  }));
  return token;
}
async function release(id, token) {
  try {
    await db.send(new UpdateItemCommand({
      TableName: jobsTable, Key: { job_id: { S: id } },
      ConditionExpression: "#t = :t", UpdateExpression: "REMOVE #l, #t",
      ExpressionAttributeNames: { "#l": "real_recovery_lease_until", "#t": "real_recovery_token" },
      ExpressionAttributeValues: { ":t": { S: token } },
    }));
  } catch (error) { if (error.name !== "ConditionalCheckFailedException") throw error; }
}
exports.handler = async (event = {}, context) => {
  const apply = event.mode === "APPLY" && process.env.ENABLE_REAL_RECOVERY === "true";
  const report = { mode: apply ? "APPLY" : "DRY_RUN", checked_at: new Date().toISOString(),
    minimum_age_minutes: 30, maximum_applies: 1, jobs: [] };
  let candidates = [];
  if (event.test_job_id) {
    candidates = [{ job_id: event.test_job_id }];
  } else {
    let lastKey;
    let scanned = 0;
    do {
      const page = await db.send(new ScanCommand({
        TableName: jobsTable, ExclusiveStartKey: lastKey, Limit: 100,
        ProjectionExpression: "job_id",
        FilterExpression: "#s IN (:asr, :ocr, :ai) AND (attribute_not_exists(test_fixture) OR test_fixture <> :yes)",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":asr": { S: "PROCESSING_ASR" }, ":ocr": { S: "PROCESSING_OCR" },
          ":ai": { S: "PROCESSING_AI" }, ":yes": { BOOL: true } },
      }));
      candidates.push(...(page.Items || []).map(plain));
      scanned += page.ScannedCount || 0;
      lastKey = page.LastEvaluatedKey;
    } while (lastKey && scanned < 2000 && (!context || context.getRemainingTimeInMillis() > 330000));
    report.scan_truncated = Boolean(lastKey);
  }
  let applied = 0;
  for (const candidate of candidates) {
    if (context && context.getRemainingTimeInMillis() < 330000) break;
    const job = await read(jobsTable, candidate.job_id);
    const skip = rules.eligible(job, { testJobId: event.test_job_id || null });
    if (skip) {
      if (skip === "MISSING_UPDATED_AT" || skip === "INVALID_IDENTITY") {
        report.jobs.push({ job_id: candidate.job_id, action: "REVIEW", reason: skip });
      }
      continue;
    }
    const row = { job_id: job.job_id, status: job.status };
    report.jobs.push(row);
    let proposal;
    try { proposal = await plan(job); }
    catch (error) {
      row.action = error.code === "SERVICE_NOT_TERMINAL" ? "WAIT_SERVICE" : "REVIEW";
      row.reason = error.code || error.name;
      continue;
    }
    row.action = proposal.action; row.source = proposal.source;
    if (proposal.action === "SKIP_SENT") continue;
    const limit = rules.budget(job, Math.floor(Date.now() / 1000));
    if (limit) { row.action = limit; continue; }
    if (!apply) { row.action = `WOULD_${proposal.action}`; continue; }
    if (applied >= 1) { row.action = "DEFERRED_NEXT_RUN"; continue; }
    let token;
    try { token = await claim(job, proposal); }
    catch (error) {
      if (error.name === "ConditionalCheckFailedException") { row.action = "SKIP_CHANGED_OR_LOCKED"; continue; }
      throw error;
    }
    applied++;
    try {
      // Handler đích tự kiểm tra lại identity/version/status.
      const invoked = await lambda.send(new InvokeCommand({
        FunctionName: proposal.target, InvocationType: "RequestResponse",
        Payload: Buffer.from(JSON.stringify(proposal.event)),
      }));
      if (invoked.FunctionError) throw Object.assign(new Error(), { code: "TARGET_HANDLER_FAILED" });
      if (invoked.StatusCode !== 200) throw Object.assign(new Error(), { code: "TARGET_INVOKE_NOT_CONFIRMED" });
      const after = await read(jobsTable, job.job_id);
      row.action = `INVOKED_${proposal.action}`;
      row.after_status = after?.status;
      row.text_handoff_state = after?.text_handoff_state;
      row.vision_handoff_state = after?.vision_handoff_state;
      // Không tự ghi SENT hoặc COMPLETED; handler đích chịu trách nhiệm.
    } catch (error) {
      row.action = "APPLY_FAILED"; row.reason = error.code || error.name;
      console.error(JSON.stringify({ event: "REAL_RECOVERY_FAILED", ...row }));
    } finally { await release(job.job_id, token); }
  }
  console.log(JSON.stringify({ event: "REAL_RECOVERY_REPORT", ...report }));
  if (report.jobs.some(row => row.action === "APPLY_FAILED")) {
    throw new Error("REAL_RECOVERY_APPLY_FAILED_REVIEW_LOGS");
  }
  return report;
};
