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
  const result = await dynamodb.send(
    new GetItemCommand({
      TableName: tableName,
      Key: {
        job_id: { S: jobId },
      },
      ConsistentRead: true,
    })
  );

  return result.Item || null;
}

/**
 * Gửi checkpoint Vision PENDING sang queue AI.
 *
 * Hàm chỉ gửi nếu Jobs và Results khớp owner/version/nguồn.
 * Đích gửi được lấy từ biến môi trường AI_QUEUE_URL.
 */
async function dispatchVisionHandoff({
  jobId,
  ownerId,
  processingVersion,
  bucket,
}) {
  if (
    typeof jobId !== "string" || !jobId ||
    typeof ownerId !== "string" || !ownerId ||
    typeof processingVersion !== "string" || !processingVersion ||
    typeof bucket !== "string" || !bucket
  ) {
    throw new Error("Thieu thong tin ban giao Vision");
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

  const allowedStatuses = [
    "PROCESSING_AI",
    "COMPLETED",
    "COMPLETED_WITH_WARNING",
  ];

  if (!allowedStatuses.includes(job.status?.S)) {
    throw new Error("Trang thai job khong cho phep ban giao Vision");
  }

  if (job.vision_handoff_state?.S === "SENT") {
    return {
      job_id: jobId,
      handoff_state: "SENT",
      already_sent: true,
    };
  }

  if (job.vision_handoff_state?.S !== "PENDING") {
    throw new Error("Checkpoint Vision khong o trang thai PENDING");
  }

  const result = await readItem(resultsTable, jobId);

  const transcriptKey = result?.transcript_key?.S;
  const source = result?.content_source?.S;
  const resultVersion = result?.processing_version?.S;

  if (
    !transcriptKey ||
    source !== "VISION" ||
    resultVersion !== processingVersion
  ) {
    throw new Error("Results Vision khong hop le");
  }

  const expectedPrefix = `results/${ownerId}/${jobId}/`;

  if (!transcriptKey.startsWith(expectedPrefix)) {
    throw new Error("Transcript key khong thuoc job");
  }

  // Gửi trước. Nếu gửi thất bại, checkpoint vẫn là PENDING.
  const messageId = await publishTranscript({
    bucket,
    key: transcriptKey,
    jobId,
    ownerId,
    source: "VISION",
    processingVersion,
  });

  // Chỉ đánh dấu SENT nếu job vẫn ở đúng trạng thái và version.
  await dynamodb.send(
    new UpdateItemCommand({
      TableName: jobsTable,

      Key: {
        job_id: { S: jobId },
      },

      ConditionExpression:
        "#owner = :owner " +
        "AND #status IN (:status, :completed, :completedWarning) " +
        "AND #version = :version AND #handoff = :pending",

      UpdateExpression:
        "SET #handoff = :sent, #updated = :now",

      ExpressionAttributeNames: {
        "#owner": "owner_id",
        "#status": "status",
        "#version": "processing_version",
        "#handoff": "vision_handoff_state",
        "#updated": "updated_at",
      },

      ExpressionAttributeValues: {
        ":owner": { S: ownerId },
        ":status": { S: "PROCESSING_AI" },
        ":completed": { S: "COMPLETED" },
        ":completedWarning": { S: "COMPLETED_WITH_WARNING" },
        ":version": { S: processingVersion },
        ":pending": { S: "PENDING" },
        ":sent": { S: "SENT" },
        ":now": { S: new Date().toISOString() },
      },
    })
  );

  return {
    job_id: jobId,
    handoff_state: "SENT",
    already_sent: false,
    message_id: messageId,
    transcript_key: transcriptKey,
  };
}

module.exports = { dispatchVisionHandoff };