const {
  DynamoDBClient,
  GetItemCommand,
} = require("@aws-sdk/client-dynamodb");

const { dispatchTextHandoff } = require("./dispatchTextHandoff");

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

async function readItem(tableName, jobId) {
  const response = await dynamodb.send(
    new GetItemCommand({
      TableName: tableName,
      Key: {
        job_id: { S: jobId },
      },
      ConsistentRead: true,
    })
  );

  return response.Item || null;
}

/**
 * Xác định event ASR/OCR cần:
 * - PROCESS: tiếp tục xử lý nguồn hiện tại.
 * - RECOVERED: đã xử lý hoặc gửi lại checkpoint.
 * - SKIPPED: job đã xóa hoặc đã chuyển sang nguồn khác.
 */
async function recoverTextHandoff({
  jobId,
  ownerId,
  processingVersion,
  bucket,
  source,
}) {
  if (
    typeof jobId !== "string" || !jobId ||
    typeof ownerId !== "string" || !ownerId ||
    typeof processingVersion !== "string" || !processingVersion ||
    typeof bucket !== "string" || !bucket ||
    !["ASR", "OCR"].includes(source)
  ) {
    throw new Error("Thong tin recovery transcript khong hop le");
  }

  const jobsTable =
    process.env.JOBS_TABLE || "ddb-cloudtutor-jobs";

  const resultsTable =
    process.env.RESULTS_TABLE || "ddb-cloudtutor-results";

  const job = await readItem(jobsTable, jobId);

  if (!job) {
    throw new Error("Khong tim thay job");
  }

  if (job.owner_id?.S !== ownerId) {
    throw new Error("Owner khong khop");
  }

  const status = job.status?.S;

  if (status === "DELETING" || status === "DELETED") {
    return {
      action: "SKIPPED",
      reason: "JOB_DELETED",
    };
  }

  if (job.processing_version?.S !== processingVersion) {
    throw new Error("Processing version khong khop");
  }

  // ASR: PROCESSING_OCR cũng được cho đi tiếp, vì event
  // ASR rỗng có thể cần thử lại việc tạo MediaConvert.
  if (
    source === "ASR" &&
    ["PROCESSING_ASR", "PROCESSING_OCR"].includes(status)
  ) {
    return { action: "PROCESS" };
  }

  if (source === "OCR" && status === "PROCESSING_OCR") {
    return { action: "PROCESS" };
  }

  if (
    [
      "PROCESSING_AI",
      "COMPLETED",
      "COMPLETED_WITH_WARNING",
    ].includes(status)
  ) {
    const result = await readItem(resultsTable, jobId);

    // Event cũ của nguồn khác không được bàn giao lại.
    if (
      result?.content_source?.S !== source ||
      result?.processing_version?.S !== processingVersion
    ) {
      return {
        action: "SKIPPED",
        reason: "OTHER_SOURCE_OR_VERSION",
      };
    }

    const handoffState = job.text_handoff_state?.S;

    if (handoffState === "SENT") {
      return {
        action: "RECOVERED",
        already_sent: true,
      };
    }

    if (handoffState === "PENDING" && status === "PROCESSING_AI") {
      const handoff = await dispatchTextHandoff({
        jobId,
        ownerId,
        processingVersion,
        bucket,
        source,
      });

      return {
        action: "RECOVERED",
        already_sent: handoff.already_sent,
      };
    }

    throw new Error(
      `Checkpoint transcript chua xu ly duoc: ${handoffState || "MISSING"}`
    );
  }

  // Event ASR/OCR đến muộn khi job đã chuyển sang Vision.
  if (status === "PROCESSING_VISION") {
    return {
      action: "SKIPPED",
      reason: "JOB_ALREADY_IN_VISION",
    };
  }

  throw new Error(`Trang thai job chua ho tro: ${status || "UNKNOWN"}`);
}

module.exports = { recoverTextHandoff };