"use strict";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function eligible(job, { now = Date.now(), testJobId = null } = {}) {
  if (!job) return "MISSING_JOB";
  if (!["PROCESSING_ASR", "PROCESSING_OCR", "PROCESSING_AI"].includes(job.status)) {
    return "STATUS_NOT_RECOVERABLE";
  }
  for (const field of ["job_id", "owner_id", "processing_version"]) {
    if (typeof job[field] !== "string" || !/^[A-Za-z0-9_-]+$/.test(job[field])) {
      return "INVALID_IDENTITY";
    }
  }
  if (testJobId) {
    return job.test_fixture === true && job.job_id === testJobId
      ? null : "NOT_DESIGNATED_TEST_FIXTURE";
  }
  if (job.test_fixture === true) return "TEST_FIXTURE_EXCLUDED";
  const updated = Date.parse(job.updated_at);
  if (!Number.isFinite(updated)) return "MISSING_UPDATED_AT";
  if (now - updated < 30 * 60000) return "NOT_STALE";
  return null;
}

function pendingSource(job, result) {
  if (!result || result.job_id !== job.job_id ||
      result.processing_version !== job.processing_version ||
      typeof result.transcript_key !== "string" ||
      !result.transcript_key.startsWith(`results/${job.owner_id}/${job.job_id}/`) ||
      !["ASR", "OCR", "VISION"].includes(result.content_source)) {
    fail("REVIEW_RESULTS_MISMATCH");
  }
  const source = result.content_source;
  const field = source === "VISION" ? "vision_handoff_state" : "text_handoff_state";
  if (job[field] === "SENT") return { action: "SKIP_SENT", source, field };
  if (job[field] !== "PENDING") fail("REVIEW_CHECKPOINT_NOT_PENDING");
  return { action: "RECOVER_PENDING", source, field };
}

function asrEvent(job, service, bucket) {
  if (!job.transcription_job_name?.startsWith("transcribe-cloudtutor-") ||
      service.TranscriptionJobName !== job.transcription_job_name ||
      service.Media?.MediaFileUri !== `s3://${bucket}/${job.video_key}` ||
      !job.video_key?.startsWith(`videos/${job.owner_id}/${job.job_id}/`)) {
    fail("REVIEW_TRANSCRIBE_IDENTITY_MISMATCH");
  }
  if (!["COMPLETED", "FAILED"].includes(service.TranscriptionJobStatus)) {
    fail("SERVICE_NOT_TERMINAL");
  }
  return { detail: {
    TranscriptionJobName: job.transcription_job_name,
    TranscriptionJobStatus: service.TranscriptionJobStatus,
  } };
}

function mediaEvent(job, service, bucket, files = [], pendingOnly = false) {
  const metadata = service.UserMetadata || {};
  const inputs = service.Settings?.Inputs || [];
  if (service.Id !== job.ocr_mediaconvert_job_id ||
      metadata.project !== "cloudtutor" || metadata.stage !== "extract-frames" ||
      metadata.owner_id !== job.owner_id || metadata.job_id !== job.job_id ||
      metadata.processing_version !== job.processing_version ||
      inputs.length !== 1 ||
      inputs[0].FileInput !== `s3://${bucket}/${job.video_key}` ||
      !job.video_key?.startsWith(`videos/${job.owner_id}/${job.job_id}/`)) {
    fail("REVIEW_MEDIACONVERT_IDENTITY_MISMATCH");
  }
  const interval = Number(metadata.frame_interval_seconds);
  if (!Number.isFinite(interval) || interval <= 0) fail("REVIEW_FRAME_INTERVAL");
  if (!["COMPLETE", "ERROR"].includes(service.Status)) fail("SERVICE_NOT_TERMINAL");
  if (pendingOnly && service.Status !== "COMPLETE") fail("REVIEW_PENDING_OCR_SERVICE_STATUS");

  const detail = { status: service.Status, jobId: service.Id, userMetadata: metadata };
  if (service.Status === "ERROR") {
    detail.errorCode = service.ErrorCode;
    detail.errorMessage = service.ErrorMessage || "MediaConvert failed";
  } else if (!pendingOnly) {
    const groups = service.Settings?.OutputGroups || [];
    const matches = groups.map((group, index) => ({ group, index }))
      .filter(({ group }) => group.Name === "CloudTutorDerived");
    if (matches.length !== 1) fail("REVIEW_DERIVED_GROUP");
    const { group, index } = matches[0];
    const outputs = group.Outputs || [];
    if (outputs.length !== 1 || outputs[0].ContainerSettings?.Container !== "MP4") {
      fail("REVIEW_DERIVED_OUTPUT");
    }
    const durations = service.OutputGroupDetails?.[index]?.OutputDetails || [];
    const duration = durations[0]?.DurationInMs;
    if (durations.length !== 1 || !Number.isFinite(duration) || duration <= 0) {
      fail("REVIEW_MISSING_SERVICE_DURATION");
    }
    const prefix = `derived/${job.owner_id}/${job.job_id}/`;
    const mp4s = files.filter(key => key.startsWith(prefix) && /\.mp4$/i.test(key));
    if (mp4s.length !== 1) fail("REVIEW_DERIVED_FILES");
    detail.outputGroupDetails = [{ outputDetails: [{
      durationInMs: duration,
      outputFilePaths: [`s3://${bucket}/${mp4s[0]}`],
    }] }];
  }
  return { detail };
}

function budget(job, nowSeconds) {
  if (Number(job.real_recovery_lease_until || 0) >= nowSeconds) return "LEASED";
  if (job.real_recovery_version === job.processing_version) {
    if (Number(job.real_recovery_attempts || 0) >= 3) return "REVIEW_RETRY_LIMIT";
    if (Number(job.real_recovery_next_at || 0) > nowSeconds) return "BACKOFF";
  }
  return null;
}

module.exports = { eligible, pendingSource, asrEvent, mediaEvent, budget };
