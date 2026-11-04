"use strict";
const assert = require("node:assert/strict");
const rules = require("./recoveryRules");
const now = Date.parse("2026-10-30T12:00:00Z");
const base = { job_id: "job-1", owner_id: "owner-1", processing_version: "v-1",
  status: "PROCESSING_ASR", updated_at: "2026-10-30T10:00:00Z",
  video_key: "videos/owner-1/job-1/source.mp4", transcription_job_name: "transcribe-cloudtutor-job-1-v-1" };
let count = 0;
function test(name, fn) { fn(); console.log("PASS:", name); count++; }
test("real stale job is eligible", () => assert.equal(rules.eligible(base, { now }), null));
for (const status of ["DELETING", "DELETED", "FAILED", "COMPLETED", "PROCESSING_VISION"]) {
  test(`skip ${status}`, () => assert.equal(rules.eligible({ ...base, status }, { now }), "STATUS_NOT_RECOVERABLE"));
}
test("exclude fixtures from normal schedule", () => assert.equal(rules.eligible({ ...base, test_fixture: true }, { now }), "TEST_FIXTURE_EXCLUDED"));
test("explicit test cannot target real job", () => assert.equal(rules.eligible(base, { now, testJobId: base.job_id }), "NOT_DESIGNATED_TEST_FIXTURE"));
test("skip fresh job", () => assert.equal(rules.eligible({ ...base, updated_at: new Date(now - 60000).toISOString() }, { now }), "NOT_STALE"));
test("missing timestamp requires review", () => assert.equal(rules.eligible({ ...base, updated_at: null }, { now }), "MISSING_UPDATED_AT"));
const result = { job_id: base.job_id, processing_version: base.processing_version, content_source: "ASR", transcript_key: "results/owner-1/job-1/normalized-transcript.json" };
test("never resend SENT", () => assert.equal(rules.pendingSource({ ...base, text_handoff_state: "SENT" }, result).action, "SKIP_SENT"));
test("pending checkpoint eligible", () => assert.equal(rules.pendingSource({ ...base, text_handoff_state: "PENDING" }, result).action, "RECOVER_PENDING"));
test("reject Results version mismatch", () => assert.throws(() => rules.pendingSource(base, { ...result, processing_version: "other" }), /REVIEW_RESULTS_MISMATCH/));
const asr = { TranscriptionJobName: base.transcription_job_name, TranscriptionJobStatus: "COMPLETED", Media: { MediaFileUri: "s3://bucket/" + base.video_key } };
test("build ASR replay from service", () => assert.equal(rules.asrEvent(base, asr, "bucket").detail.TranscriptionJobStatus, "COMPLETED"));
test("reject ASR media mismatch", () => assert.throws(() => rules.asrEvent(base, { ...asr, Media: {} }, "bucket"), /REVIEW_TRANSCRIBE_IDENTITY_MISMATCH/));
const ocrJob = { ...base, status: "PROCESSING_OCR", ocr_mediaconvert_job_id: "media-1" };
const mc = { Id: "media-1", Status: "COMPLETE", UserMetadata: { project: "cloudtutor", stage: "extract-frames", owner_id: "owner-1", job_id: "job-1", processing_version: "v-1", frame_interval_seconds: "5" },
  Settings: { Inputs: [{ FileInput: "s3://bucket/" + base.video_key }], OutputGroups: [ { Name: "CloudTutorFrames" }, { Name: "CloudTutorDerived", Outputs: [{ ContainerSettings: { Container: "MP4" } }] } ] },
  OutputGroupDetails: [{ OutputDetails: [{ DurationInMs: 15000 }] }, { OutputDetails: [{ DurationInMs: 12040 }] }] };
test("OCR uses derived service duration, not frame duration", () => assert.equal(rules.mediaEvent(ocrJob, mc, "bucket", ["derived/owner-1/job-1/source_derived.mp4"]).detail.outputGroupDetails[0].outputDetails[0].durationInMs, 12040));
test("missing duration requires review", () => assert.throws(() => rules.mediaEvent(ocrJob, { ...mc, OutputGroupDetails: [] }, "bucket", ["derived/owner-1/job-1/source_derived.mp4"]), /REVIEW_MISSING_SERVICE_DURATION/));
test("wrong MediaConvert job rejected", () => assert.throws(() => rules.mediaEvent(ocrJob, { ...mc, Id: "other" }, "bucket"), /REVIEW_MEDIACONVERT_IDENTITY_MISMATCH/));
test("wrong MC owner rejected", () => assert.throws(() => rules.mediaEvent(ocrJob, { ...mc, UserMetadata: { ...mc.UserMetadata, owner_id: "other" } }, "bucket"), /REVIEW_MEDIACONVERT_IDENTITY_MISMATCH/));
test("pending OCR replay does not invent duration", () => assert.equal(rules.mediaEvent(ocrJob, { ...mc, OutputGroupDetails: [] }, "bucket", [], true).detail.outputGroupDetails, undefined));
test("ERROR replay preserves service error", () => assert.equal(rules.mediaEvent(ocrJob, { ...mc, Status: "ERROR", ErrorCode: 42, ErrorMessage: "Service failure" }, "bucket").detail.errorCode, 42));
test("lease prevents competing reconciler", () => assert.equal(rules.budget({ ...base, real_recovery_lease_until: now / 1000 + 10 }, now / 1000), "LEASED"));
test("retry cap applies per version", () => assert.equal(rules.budget({ ...base, real_recovery_version: "v-1", real_recovery_attempts: 3 }, now / 1000), "REVIEW_RETRY_LIMIT"));
test("new version has separate attempt budget", () => assert.equal(rules.budget({ ...base, real_recovery_version: "old", real_recovery_attempts: 3, real_recovery_next_at: now / 1000 + 10 }, now / 1000), null));
console.log(`PASS: ${count} recovery rule checks`);
