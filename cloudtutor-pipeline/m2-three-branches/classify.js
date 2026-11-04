"use strict";
const M2_CODES = new Set(["ASR_SERVICE_FAILED", "MEDIACONVERT_FAILED", "VISION_NO_USEFUL_SAMPLED_FRAMES", "VISION_GEMINI_RETRIES_EXHAUSTED", "VIDEO_TOO_LARGE", "VIDEO_INVALID_MP4_HEADER", "VIDEO_EMPTY_OR_INVALID_SIZE", "VIDEO_EXTENSION_NOT_MP4"]);
function inspectDocument(doc, job, result) {
  const errors = [];
  if (!doc || typeof doc !== "object") return ["SOURCE_NOT_JSON_OBJECT"];
  if (doc.schema_version !== "1.0") errors.push("SCHEMA_VERSION");
  if (doc.job_id !== job.job_id?.S) errors.push("JOB_ID");
  if (doc.owner_id !== job.owner_id?.S) errors.push("OWNER_ID");
  if (doc.processing_version !== job.processing_version?.S) errors.push("PROCESSING_VERSION");
  if (doc.source !== result.content_source?.S) errors.push("SOURCE");
  if (typeof doc.text !== "string" || !doc.text.trim()) errors.push("EMPTY_TEXT");
  if (!Array.isArray(doc.warnings)) errors.push("WARNINGS_NOT_ARRAY");
  if (!Array.isArray(doc.segments) || !doc.segments.length) errors.push("EMPTY_SEGMENTS");
  else for (const s of doc.segments) {
    if (!Number.isFinite(s.start_time) || !Number.isFinite(s.end_time) || s.start_time < 0 || s.end_time <= s.start_time || typeof s.text !== "string" || !s.text.trim() || s.source !== doc.source) { errors.push("INVALID_SEGMENT"); break; }
  }
  return errors;
}
function classify(expected, job, result, doc) {
  const status = job?.status?.S || "MISSING_JOB", error = job?.error_code?.S || null;
  const source = result?.content_source?.S || null;
  const common = { status, source, error_code: error, next_retry_at: job?.next_retry_at?.N || null };
  if (!job) return { ...common, verdict: "WAITING_FOR_JOB", area: "M2_TEST_SETUP" };
  if (source && result?.processing_version?.S !== job.processing_version?.S) return { ...common, verdict: "RESULT_VERSION_MISMATCH", area: "M2_OR_M3_RESULTS_WRITER_REVIEW" };
  if (source && doc) {
    const errors = inspectDocument(doc, job, result);
    if (errors.length) return { ...common, verdict: "SOURCE_CONTRACT_INVALID", area: "M2_SOURCE_OR_RESULTS_OVERWRITE_REVIEW", validation_errors: errors };
    const handoff = source === "VISION" ? job.vision_handoff_state?.S : job.text_handoff_state?.S;
    if (handoff === "SENT") return { ...common, handoff, verdict: source === expected ? "M2_PASS" : "BRANCH_DIFFERS_REVIEW_INPUT", area: source === expected ? "M2_SOURCE_AND_HANDOFF" : "INPUT_OR_ROUTING_REVIEW", downstream_status: status };
    if (status === "FAILED" && !M2_CODES.has(error)) return { ...common, handoff, verdict: "SOURCE_READY_DOWNSTREAM_FAILURE_REVIEW", area: "M3_OR_HANDOFF_RACE_REVIEW" };
    return { ...common, handoff, verdict: "SOURCE_READY_HANDOFF_PENDING", area: "M2_HANDOFF_REVIEW" };
  }
  if (status === "FAILED") {
    if (error === "VISION_NO_USEFUL_SAMPLED_FRAMES") return { ...common, verdict: "NO_USEFUL_SELECTED_FRAMES", area: "INPUT_CONTENT_REVIEW_NOT_AUTOMATIC_CODE_BUG" };
    return { ...common, verdict: "FAILED_REQUIRES_STAGE_LOG", area: M2_CODES.has(error) || error?.startsWith("VISION_") ? "M2_STAGE" : "UNKNOWN_CHECK_FIRST_FAILING_COMPONENT" };
  }
  if (job.vision_retry_state?.S === "WAITING") return { ...common, verdict: "DEFERRED_RETRY_OR_QUOTA", area: "M2_VISION_PROVIDER_OR_QUOTA" };
  return { ...common, verdict: "WAITING", area: "CHECK_STAGE_IF_TIMEOUT" };
}
module.exports = { inspectDocument, classify };
