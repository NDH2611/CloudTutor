const {
  TranscribeClient,
  GetTranscriptionJobCommand,
} = require("@aws-sdk/client-transcribe");

const {
  MediaConvertClient,
  GetJobCommand,
} = require("@aws-sdk/client-mediaconvert");

const { findStaleJobs } = require("./reconcileJobs");

const region = process.env.AWS_REGION || "ap-southeast-1";

const transcribe = new TranscribeClient({ region });
const mediaConvert = new MediaConvertClient({ region });

/**
 * Đối chiếu trạng thái dịch vụ cho job quá hạn.
 * Chỉ đọc; không sửa job, không invoke Lambda và không gửi SQS.
 */
async function inspectJob(job) {
  const result = {
    ...job,
    service_status: null,
    inspection: null,
  };

  if (job.status === "PROCESSING_ASR") {
    if (!job.transcription_job_name) {
      result.inspection = "MISSING_TRANSCRIBE_JOB_NAME";
      return result;
    }

    try {
      const response = await transcribe.send(
        new GetTranscriptionJobCommand({
          TranscriptionJobName: job.transcription_job_name,
        })
      );

      const status = response.TranscriptionJob?.TranscriptionJobStatus;

      result.service_status = status || "UNKNOWN";

      if (status === "COMPLETED" || status === "FAILED") {
        result.inspection = "TRANSCRIBE_TERMINAL_REVIEW_EVENT";
      } else {
        result.inspection = "TRANSCRIBE_NOT_TERMINAL";
      }
    } catch (error) {
      result.inspection = "TRANSCRIBE_LOOKUP_ERROR";
      result.lookup_error = error.name || "UnknownError";
    }

    return result;
  }

  if (job.status === "PROCESSING_OCR") {
    if (!job.ocr_mediaconvert_job_id) {
      result.inspection = "MISSING_OCR_MEDIACONVERT_JOB_ID";
      return result;
    }

    try {
      const response = await mediaConvert.send(
        new GetJobCommand({
          Id: job.ocr_mediaconvert_job_id,
        })
      );

      const status = response.Job?.Status;

      result.service_status = status || "UNKNOWN";

      if (status === "COMPLETE" || status === "ERROR") {
        result.inspection = "MEDIACONVERT_TERMINAL_REVIEW_EVENT";
      } else {
        result.inspection = "MEDIACONVERT_NOT_TERMINAL";
      }
    } catch (error) {
      result.inspection = "MEDIACONVERT_LOOKUP_ERROR";
      result.lookup_error = error.name || "UnknownError";
    }

    return result;
  }

  if (job.status === "PROCESSING_VISION") {
    result.inspection = "REVIEW_VISION_QUEUE_AND_CHECKPOINT";
    return result;
  }

  if (job.status === "PROCESSING_AI") {
    result.inspection = "REVIEW_AI_QUEUE_AND_CHECKPOINT";
    return result;
  }

  result.inspection = "NO_INSPECTION_RULE";
  return result;
}

async function main() {
  const thresholdMinutes = Number(process.argv[2] || "30");
  const includeTestFixtures = process.argv.includes("--include-test");

  const scan = await findStaleJobs({
    thresholdMinutes,
    includeTestFixtures,
  });

  const inspectedJobs = [];

  // Đọc lần lượt để tránh gửi quá nhiều yêu cầu AWS cùng lúc.
  for (const job of scan.stale_jobs) {
    inspectedJobs.push(await inspectJob(job));
  }

  console.log(
    JSON.stringify(
      {
        mode: "READ_ONLY",
        checked_at: scan.checked_at,
        threshold_minutes: scan.threshold_minutes,
        include_test_fixtures: scan.include_test_fixtures,
        stale_count: inspectedJobs.length,
        missing_updated_at: scan.missing_updated_at,
        jobs: inspectedJobs,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Khong doi chieu duoc job:", error.message);
  process.exitCode = 1;
});