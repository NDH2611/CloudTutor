const {
  DynamoDBClient,
  GetItemCommand,
} = require("@aws-sdk/client-dynamodb");

const { dispatchVisionHandoff } = require("./dispatchVisionHandoff");

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

/**
 * Kiểm tra xem job Vision đã có checkpoint bàn giao hay chưa.
 *
 * Kết quả:
 * - action = "PROCESS_VISION": cần xử lý Vision.
 * - action = "HANDOFF_RECOVERED": đã gửi hoặc checkpoint đã SENT.
 * - action = "JOB_DELETED": job đang xóa hoặc đã xóa.
 */
async function recoverVisionHandoff({
  jobId,
  ownerId,
  processingVersion,
  bucket,
}) {
  if (
    typeof jobId !== "string" ||
    !jobId ||
    typeof ownerId !== "string" ||
    !ownerId ||
    typeof processingVersion !== "string" ||
    !processingVersion ||
    typeof bucket !== "string" ||
    !bucket
  ) {
    throw new Error("Thieu thong tin khoi phuc Vision");
  }

  const jobsTable =
    process.env.JOBS_TABLE || "ddb-cloudtutor-jobs";

  const response = await dynamodb.send(
    new GetItemCommand({
      TableName: jobsTable,
      Key: {
        job_id: { S: jobId },
      },
      ConsistentRead: true,
    })
  );

  const job = response.Item;

  if (!job) {
    throw new Error("Khong tim thay job Vision");
  }

  if (job.owner_id?.S !== ownerId) {
    throw new Error("Owner Vision khong khop");
  }

  const status = job.status?.S;

  if (status === "DELETING" || status === "DELETED") {
    return {
      action: "JOB_DELETED",
      job_id: jobId,
    };
  }

  if (job.processing_version?.S !== processingVersion) {
    throw new Error("Processing version Vision khong khop");
  }

  const handoffState = job.vision_handoff_state?.S;

  // Chưa tạo checkpoint: tiếp tục nhánh xử lý Vision.
  if (status === "PROCESSING_VISION" && !handoffState) {
    return {
      action: "PROCESS_VISION",
      job_id: jobId,
    };
  }

  // Nếu transaction đã tạo checkpoint, không gọi Gemini lại.
  if (
    handoffState === "PENDING" ||
    handoffState === "SENT"
  ) {
    const result = await dispatchVisionHandoff({
      jobId,
      ownerId,
      processingVersion,
      bucket,
    });

    return {
      action: "HANDOFF_RECOVERED",
      job_id: jobId,
      handoff_state: result.handoff_state,
      already_sent: result.already_sent,
    };
  }

  // Không tự bỏ qua trạng thái chưa hiểu.
  throw new Error(
    `Trang thai Vision chua ho tro: ${status || "UNKNOWN"}`
  );
}

module.exports = { recoverVisionHandoff };