const {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");

const { publishTranscript } = require("./publishTranscript");

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
 * Gửi checkpoint ASR/OCR sang SQS AI.
 *
 * Khi SendMessage thất bại, checkpoint vẫn là PENDING.
 * Nếu đã SENT, hàm không gửi lại trong lần chạy tuần tự.
 */
async function dispatchTextHandoff({
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
    typeof bucket !== "string" || !bucket
  ) {
    throw new Error("Thieu thong tin ban giao transcript");
  }

  if (!["ASR", "OCR"].includes(source)) {
    throw new Error("Source phai la ASR hoac OCR");
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

  if (job.processing_version?.S !== processingVersion) {
    throw new Error("Processing version khong khop");
  }

  const status = job.status?.S;
  const handoffState = job.text_handoff_state?.S;

  if (
    status === "DELETING" ||
    status === "DELETED"
  ) {
    return {
      job_id: jobId,
      skipped: true,
      reason: "JOB_DELETED",
    };
  }

  // Đọc Results để xác nhận checkpoint thực sự thuộc
  // nguồn ASR/OCR mà lượt xử lý này muốn bàn giao.
  const result = await readItem(resultsTable, jobId);

  const transcriptKey = result?.transcript_key?.S;
  const resultSource = result?.content_source?.S;
  const resultVersion = result?.processing_version?.S;

  if (
    !transcriptKey ||
    resultSource !== source ||
    resultVersion !== processingVersion
  ) {
    throw new Error("Results khong khop source hoac version");
  }

  const expectedPrefix = `results/${ownerId}/${jobId}/`;

  if (!transcriptKey.startsWith(expectedPrefix)) {
    throw new Error("Transcript key khong thuoc job");
  }

  if (
    handoffState === "SENT" &&
    [
      "PROCESSING_AI",
      "COMPLETED",
      "COMPLETED_WITH_WARNING",
    ].includes(status)
  ) {
    return {
      job_id: jobId,
      skipped: false,
      handoff_state: "SENT",
      already_sent: true,
    };
  }

  // Chỉ gửi mới khi checkpoint là PENDING và job
  // vẫn đang ở trạng thái PROCESSING_AI.
  if (status !== "PROCESSING_AI" || handoffState !== "PENDING") {
    throw new Error(
      "Job hoac checkpoint khong o trang thai cho phep gui"
    );
  }

  const messageId = await publishTranscript({
    bucket,
    key: transcriptKey,
    jobId,
    ownerId,
    source,
    processingVersion,
  });

  // Nếu AI xử lý nhanh, job có thể đã COMPLETED trước khi
  // Lambda này kịp cập nhật checkpoint.
  await dynamodb.send(
    new UpdateItemCommand({
      TableName: jobsTable,

      Key: {
        job_id: { S: jobId },
      },

      ConditionExpression:
        "#owner = :owner " +
        "AND #status IN (:processing, :completed, :warning) " +
        "AND #version = :version " +
        "AND #handoff = :pending",

      UpdateExpression:
        "SET #handoff = :sent, #updated = :now",

      ExpressionAttributeNames: {
        "#owner": "owner_id",
        "#status": "status",
        "#version": "processing_version",
        "#handoff": "text_handoff_state",
        "#updated": "updated_at",
      },

      ExpressionAttributeValues: {
        ":owner": { S: ownerId },
        ":processing": { S: "PROCESSING_AI" },
        ":completed": { S: "COMPLETED" },
        ":warning": { S: "COMPLETED_WITH_WARNING" },
        ":version": { S: processingVersion },
        ":pending": { S: "PENDING" },
        ":sent": { S: "SENT" },
        ":now": { S: new Date().toISOString() },
      },
    })
  );

  return {
    job_id: jobId,
    skipped: false,
    handoff_state: "SENT",
    already_sent: false,
    message_id: messageId,
    transcript_key: transcriptKey,
    source,
  };
}

module.exports = { dispatchTextHandoff };