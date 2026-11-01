"use strict";
process.env.AWS_PROFILE = "new";
process.env.AWS_REGION = "ap-southeast-1";
const fs = require("node:fs"), path = require("node:path"), { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { DynamoDBClient, PutItemCommand, GetItemCommand } = require("@aws-sdk/client-dynamodb");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { classify } = require("./classify");
const db = new DynamoDBClient({ region: "ap-southeast-1", maxAttempts: 2 });
const s3 = new S3Client({ region: "ap-southeast-1", maxAttempts: 2 });
const bucket = "s3-cloudtutor-media-251929332061", owner = "test-user";
const functions = ["lambda-cloudtutor-start-transcription", "lambda-cloudtutor-transcription-completed", "lambda-cloudtutor-process-frames", "lambda-cloudtutor-vision-fallback"];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function aws(args) { const out = execFileSync("aws", [...args, "--region", "ap-southeast-1", "--profile", "new", "--output", "json", "--no-cli-pager"], { encoding: "utf8", windowsHide: true, timeout: 90000, maxBuffer: 8 * 1024 * 1024 }); return out.trim() ? JSON.parse(out) : {}; }
function save(file, obj) { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }
async function get(table, id) { return (await db.send(new GetItemCommand({ TableName: table, Key: { job_id: { S: id } }, ConsistentRead: true }))).Item; }
async function readSource(result, item) {
  const key = result?.transcript_key?.S;
  if (!key) return null;
  if (!key.startsWith(`results/${owner}/${item.job_id}/`)) throw new Error("RESULT_KEY_OUTSIDE_TEST_JOB");
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (r.ContentLength > 4 * 1024 * 1024) throw new Error("SOURCE_TOO_LARGE_FOR_TEST_INSPECTION");
  const text = await r.Body.transformToString("utf8");
  if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error("SOURCE_TOO_LARGE_FOR_TEST_INSPECTION");
  return JSON.parse(text);
}
async function inspect(run, folder) {
  for (const item of run.cases) {
    const job = await get("ddb-cloudtutor-jobs", item.job_id);
    const result = await get("ddb-cloudtutor-results", item.job_id);
    let doc = null;
    try { doc = await readSource(result, item); item.source_read_error = null; }
    catch (e) { item.source_read_error = { name: e.name, message: e.message }; }
    item.assessment = classify(item.expected_source, job, result, doc);
    if (item.source_read_error) { item.assessment.verdict = "SOURCE_READ_OR_PARSE_ERROR"; item.assessment.area = "M2_REFERENCE_OR_S3_PERMISSION_REVIEW"; }
    if (job) save(path.join(folder, `${item.name}-job.json`), job);
    if (result) save(path.join(folder, `${item.name}-results.json`), result);
    if (doc) save(path.join(folder, `${item.name}-source.json`), doc);
    const signature = `${job?.status?.S}|${item.assessment.verdict}|${job?.error_code?.S || ""}|${item.assessment.source || ""}`;
    if (signature !== item.last_signature) {
      item.timeline.push({ observed_at: new Date().toISOString(), ...item.assessment });
      item.last_signature = signature;
      console.log(`${item.name}: ${item.assessment.verdict}; status=${item.assessment.status}; source=${item.assessment.source || "-"}; error=${item.assessment.error_code || "-"}`);
    }
    item.last_job = { status: job?.status?.S, transcription_job_name: job?.transcription_job_name?.S, ocr_mediaconvert_job_id: job?.ocr_mediaconvert_job_id?.S };
  }
  run.checked_at = new Date().toISOString(); save(path.join(folder, "run.json"), run);
}
function done(item) {
  const v = item.assessment?.verdict;
  return ["M2_PASS", "BRANCH_DIFFERS_REVIEW_INPUT", "SOURCE_CONTRACT_INVALID", "RESULT_VERSION_MISMATCH", "SOURCE_READY_DOWNSTREAM_FAILURE_REVIEW", "FAILED_REQUIRES_STAGE_LOG", "NO_USEFUL_SELECTED_FRAMES", "SOURCE_READ_OR_PARSE_ERROR"].includes(v) ||
    (v === "DEFERRED_RETRY_OR_QUOTA" && Number(item.assessment.next_retry_at || 0) > Date.now() / 1000 + 900);
}
function collectLogs(run, folder) {
  for (const item of run.cases) for (const fn of functions) {
    try {
      const r = aws(["logs", "filter-log-events", "--log-group-name", `/aws/lambda/${fn}`, "--start-time", String(Date.parse(run.started_at) - 10000), "--filter-pattern", `"${item.job_id}"`, "--limit", "100", "--no-paginate"]);
      save(path.join(folder, `${item.name}-${fn}-job-logs.json`), r);
    } catch (e) { save(path.join(folder, `${item.name}-${fn}-log-read-error.json`), { name: e.name, note: "Could not read job-scoped logs; keep run IDs for CloudWatch lookup." }); }
  }
}
async function main() {
  const folder = path.resolve(process.argv[2] || "");
  if (!fs.existsSync(folder)) throw new Error("REPORT_FOLDER_MISSING");
  if (aws(["sts", "get-caller-identity"]).Account !== "251929332061") throw new Error("WRONG_AWS_ACCOUNT");
  const runPath = path.join(folder, "run.json");
  let run;
  if (fs.existsSync(runPath)) {
    run = JSON.parse(fs.readFileSync(runPath, "utf8"));
    console.log("RESUME: polling existing jobs only; no new upload or service invocation.");
  } else {
    const configs = functions.map(fn => aws(["lambda", "get-function-configuration", "--function-name", fn, "--query", "{Name:FunctionName,Runtime:Runtime,Handler:Handler,State:State,Update:LastUpdateStatus,Bucket:Environment.Variables.MEDIA_BUCKET,AiQueue:Environment.Variables.AI_QUEUE_URL,CodeHash:CodeSha256,Layers:Layers[].Arn}"]));
    for (const c of configs) if (c.Bucket !== bucket || c.State !== "Active" || c.Update !== "Successful") throw new Error(`FUNCTION_NOT_READY: ${c.Name}`);
    save(path.join(folder, "lambda-metadata.json"), configs);
    console.log("AI destinations (unchanged):"); for (const c of configs.filter(c => c.AiQueue)) console.log(c.Name + " -> " + c.AiQueue);
    const id = randomUUID().slice(0, 8);
    run = { run_id: `m2-three-${id}`, started_at: new Date().toISOString(), scope: "REAL_MAIN_S3_NOTIFICATION_TO_M2_SOURCE_AND_SQS_HANDOFF_NOT_M3_ACCEPTANCE", cases: [
      { name: "speech", expected_source: "ASR" }, { name: "silent-text", expected_source: "OCR" }, { name: "silent-scene", expected_source: "VISION" },
    ].map(c => ({ ...c, job_id: `m2-three-${c.name}-${id}`, video_key: `videos/${owner}/m2-three-${c.name}-${id}/source.mp4`, timeline: [], upload_attempted: false })) };
    for (const item of run.cases) {
      const file = path.join(folder, `${item.name}.mp4`);
      if (!fs.existsSync(file)) throw new Error("VIDEO_MISSING: " + item.name);
      if (fs.statSync(file).size > 500000000) throw new Error("VIDEO_TOO_LARGE: " + item.name);
    }
    save(runPath, run);
    for (const item of run.cases) {
      await db.send(new PutItemCommand({ TableName: "ddb-cloudtutor-jobs", ConditionExpression: "attribute_not_exists(job_id)", Item: {
        job_id: { S: item.job_id }, owner_id: { S: owner }, video_key: { S: item.video_key }, status: { S: "UPLOADED" }, test_fixture: { BOOL: true },
        created_at: { S: new Date().toISOString() }, updated_at: { S: new Date().toISOString() },
      } }));
      item.upload_attempted = true; save(runPath, run);
      const file = path.join(folder, `${item.name}.mp4`);
      const response = await s3.send(new PutObjectCommand({ Bucket: bucket, Key: item.video_key, Body: fs.createReadStream(file), ContentType: "video/mp4" }));
      item.uploaded_at = new Date().toISOString(); item.etag = response.ETag; save(runPath, run);
      console.log("UPLOADED: " + item.name + " / " + item.job_id);
    }
  }
  const deadline = Date.now() + 15 * 60000;
  while (Date.now() < deadline) {
    await inspect(run, folder);
    if (run.cases.every(done)) break;
    await sleep(10000);
  }
  await inspect(run, folder);
  collectLogs(run, folder);
  const summary = run.cases.map(c => ({ case: c.name, expected: c.expected_source, actual: c.assessment?.source || "-", verdict: c.assessment?.verdict, area: c.assessment?.area, status: c.assessment?.status, error: c.assessment?.error_code || "-", job_id: c.job_id }));
  save(path.join(folder, "summary.json"), { scope: run.scope, cases: summary });
  console.table(summary);
  for (const item of run.cases) {
    const sourcePath = path.join(folder, `${item.name}-source.json`);
    if (fs.existsSync(sourcePath)) {
      const doc = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
      console.log(`\n=== ${item.name} / ${doc.source} TEXT ===\n${String(doc.text).slice(0, 1800)}`);
      console.log("WARNINGS:", JSON.stringify(doc.warnings));
    }
  }
  console.log("REPORT:", folder);
  console.log("No queue purge/delete/redrive, config change or forced job reset was performed.");
  if (!run.cases.every(c => c.assessment?.verdict === "M2_PASS")) console.log("REVIEW REQUIRED: send summary.json and the relevant source/job/log files. Do not start a new run just to clear an error.");
}
main().catch(e => { console.error("STOP:", e.name, e.message); console.error("Keep this report folder; resume monitoring existing jobs, do not create another run."); process.exitCode = 1; });
