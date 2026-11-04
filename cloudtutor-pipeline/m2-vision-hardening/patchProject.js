"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
function once(text, before, after, name) {
  if (text.split(before).length !== 2) throw new Error(`PATCH_ANCHOR_MISMATCH: ${name}`);
  return text.replace(before, after);
}
const changes = new Map();
let vision = fs.readFileSync(path.join(root, "onVisionFallback.js"), "utf8").replace(/\r\n/g, "\n");
if (!vision.includes("// VISION_HARDENING_V1")) {
  vision = '// VISION_HARDENING_V1\nconst { runVisionRecord } = require("./visionRuntime");\n' + vision;
  vision = once(vision, "const result = await describeFrame(imageBytes);",
    "const result = await describeFrame(imageBytes, { ...identity, frameKey: frame.key });", "frame identity");
  vision = once(vision, "const result = await processVision(message);",
    "const result = await runVisionRecord({ record, message }, () => processVision(message));", "record guard");
  vision = once(vision, "exports.handler = async (event) => {", `exports.handler = async (event) => {
  if (event?.test === "VISION_SECRET_HEALTH_CHECK") {
    return require("./visionDiagnostics").secretHealth();
  }
  if (event?.test === "VISION_FRAME_CACHE_CHECK") {
    return require("./visionDiagnostics").frameCacheCheck(event);
  }`, "diagnostics");
  vision = vision.replace(/^[ \t]*test: "VISION_CACHE_TEST",\r?\n/m, "");
  vision = once(vision, '      source: "VISION",\n      text:', '      source: "VISION",\n      model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",\n      prompt_version: process.env.GEMINI_PROMPT_VERSION || "vision-v2",\n      text:', "output provenance");
}
changes.set("onVisionFallback.js", vision);

let rules = fs.readFileSync(path.join(root, "recoveryRules.js"), "utf8").replace(/\r\n/g, "\n");
let recovery = fs.readFileSync(path.join(root, "reconcileRealJobs.js"), "utf8").replace(/\r\n/g, "\n");
let deploy = fs.readFileSync(path.join(root, "deployRealRecovery.ps1"), "utf8").replace(/\r\n/g, "\n");
if (!rules.includes("// VISION_QUOTA_RECOVERY_V1")) {
  rules = once(rules, '  if (!["PROCESSING_ASR", "PROCESSING_OCR", "PROCESSING_AI"].includes(job.status)) {',
    `  // VISION_QUOTA_RECOVERY_V1
  if (job.status === "PROCESSING_VISION") {
    if (job.vision_retry_state !== "WAITING") return "STATUS_NOT_RECOVERABLE";
    if (job.vision_retry_version !== job.processing_version) return "INVALID_IDENTITY";
    if (!Number.isFinite(job.next_retry_at)) return "MISSING_UPDATED_AT";
    if (job.next_retry_at * 1000 > now) return "VISION_RETRY_NOT_DUE";
  }
  if (!["PROCESSING_ASR", "PROCESSING_OCR", "PROCESSING_AI", "PROCESSING_VISION"].includes(job.status)) {`, "Vision eligibility");
  recovery = once(recovery, "S3Client, ListObjectsV2Command", "S3Client, ListObjectsV2Command, GetObjectCommand", "recovery S3 import");
  recovery = once(recovery, 'const source = checkpoint?.source || (job.status === "PROCESSING_ASR" ? "ASR" : "OCR");',
    'const source = checkpoint?.source || (job.status === "PROCESSING_ASR" ? "ASR" : job.status === "PROCESSING_VISION" ? "VISION" : "OCR");', "recovery source");
  recovery = once(recovery, '    // Handler Vision khôi phục checkpoint trước bước chọn frame/gọi Gemini.', `    // Handler Vision khôi phục checkpoint trước bước chọn frame/gọi Gemini.
    let extra = {};
    if (job.status === "PROCESSING_VISION") {
      const saved = await s3.send(new GetObjectCommand({ Bucket: bucket,
        Key: \`results/\${job.owner_id}/\${job.job_id}/normalized-ocr.json\` }));
      if (saved.ContentLength > 4 * 1024 * 1024) throw Object.assign(new Error(), { code: "REVIEW_OCR_CHECKPOINT_TOO_LARGE" });
      const text = await saved.Body.transformToString("utf8");
      if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw Object.assign(new Error(), { code: "REVIEW_OCR_CHECKPOINT_TOO_LARGE" });
      const normalized = JSON.parse(text);
      if (normalized.job_id !== job.job_id || normalized.owner_id !== job.owner_id ||
          normalized.processing_version !== job.processing_version || normalized.source !== "OCR" ||
          !Number.isFinite(normalized.duration_seconds) || normalized.duration_seconds <= 0 ||
          !Number.isFinite(normalized.frame_interval_seconds) || normalized.frame_interval_seconds <= 0) {
        throw Object.assign(new Error(), { code: "REVIEW_OCR_CHECKPOINT_MISMATCH" });
      }
      extra = { duration_seconds: normalized.duration_seconds,
        frame_interval_seconds: normalized.frame_interval_seconds };
    }`, "quota resume event");
  recovery = once(recovery, '        processing_version: job.processing_version }),',
    '        processing_version: job.processing_version, ...extra }),', "quota resume payload");
  recovery = once(recovery, '"#s IN (:asr, :ocr, :ai) AND', '"#s IN (:asr, :ocr, :ai, :vision) AND', "Vision scan");
  recovery = once(recovery, '":ai": { S: "PROCESSING_AI" }, ":yes":', '":ai": { S: "PROCESSING_AI" }, ":vision": { S: "PROCESSING_VISION" }, ":yes":', "Vision scan value");
  deploy = once(deploy, '                                @{ Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = @(',
    '                                @{ Effect = "Allow"; Action = "s3:GetObject"; Resource = "arn:aws:s3:::${CtBucket}/results/*" }\n                                @{ Effect = "Allow"; Action = "lambda:InvokeFunction"; Resource = @(', "recovery cache permission");
}
changes.set("recoveryRules.js", rules);
changes.set("reconcileRealJobs.js", recovery);
changes.set("deployRealRecovery.ps1", deploy);

// Xác nhận mọi anchor trước khi thay bất kỳ file nguồn nào.
for (const [name, content] of changes) fs.writeFileSync(path.join(root, name), content, "utf8");
for (const name of ["geminiVision", "geminiRetry", "geminiSecret", "visionMetrics", "visionErrors", "visionQuota", "visionFrameCache", "visionRuntime", "visionDiagnostics", "testVisionHardening", "testVisionQuotaRecovery"]) {
  fs.copyFileSync(path.join(__dirname, `${name}.js`), path.join(root, `${name}.js`));
}
fs.writeFileSync(path.join(root, "testGeminiRetry.js"), '// Retry cases are included in the full hardening suite.\nrequire("./testVisionHardening");\n', "utf8");
console.log("PATCHED: Vision secret, metrics, quota checkpoints and recovery resume.");
