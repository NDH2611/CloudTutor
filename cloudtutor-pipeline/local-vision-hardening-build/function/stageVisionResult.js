const {
  DynamoDBClient,
  TransactWriteItemsCommand,
} = require("@aws-sdk/client-dynamodb");

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

/**
 * Ghi checkpoint Vision và tham chiếu transcript.
 *
 * Hàm này KHÔNG gửi message SQS.
 * Transcript phải được lưu lên S3 trước khi gọi hàm.
 */
async function stageVisionResult({
  jobId,
  ownerId,
  processingVersion,
  transcriptKey,
}) {
  if (
    typeof jobId !== "string" ||
    !jobId ||
    typeof ownerId !== "string" ||
    !ownerId ||
    typeof processingVersion !== "string" ||
    !processingVersion ||
    typeof transcriptKey !== "string" ||
    !transcriptKey
  ) {
    throw new Error("Thieu thong tin checkpoint Vision");
  }

  const expectedPrefix = `results/${ownerId}/${jobId}/`;

  if (!transcriptKey.startsWith(expectedPrefix)) {
    throw new Error("Transcript key khong thuoc job");
  }

  const jobsTable =
    process.env.JOBS_TABLE || "ddb-cloudtutor-jobs";

  const resultsTable =
    process.env.RESULTS_TABLE || "ddb-cloudtutor-results";

  const now = new Date().toISOString();

  await dynamodb.send(
    new TransactWriteItemsCommand({
      TransactItems: [
        {
          Update: {
            TableName: jobsTable,

            Key: {
              job_id: { S: jobId },
            },

            // Chỉ cập nhật khi job vẫn thuộc owner,
            // đúng phiên xử lý và đang ở bước Vision.
            ConditionExpression:
              "#owner = :owner AND #status = :vision " +
              "AND #version = :version",

            UpdateExpression:
              "SET #status = :ai, #updated = :now, " +
              "#handoff = :pending",

            ExpressionAttributeNames: {
              "#owner": "owner_id",
              "#status": "status",
              "#version": "processing_version",
              "#updated": "updated_at",
              "#handoff": "vision_handoff_state",
            },

            ExpressionAttributeValues: {
              ":owner": { S: ownerId },
              ":vision": { S: "PROCESSING_VISION" },
              ":version": { S: processingVersion },
              ":ai": { S: "PROCESSING_AI" },
              ":now": { S: now },
              ":pending": { S: "PENDING" },
            },
          },
        },

        {
          Update: {
            TableName: resultsTable,

            Key: {
              job_id: { S: jobId },
            },

            // Chỉ tạo Results mới, hoặc cập nhật item đã có
            // đúng cùng version, source và transcript key.
            ConditionExpression:
              "attribute_not_exists(job_id) OR " +
              "(#version = :version AND #source = :source " +
              "AND #transcript = :key)",

            UpdateExpression:
              "SET #transcript = :key, #source = :source, " +
              "#version = :version",

            ExpressionAttributeNames: {
              "#transcript": "transcript_key",
              "#source": "content_source",
              "#version": "processing_version",
            },

            ExpressionAttributeValues: {
              ":key": { S: transcriptKey },
              ":source": { S: "VISION" },
              ":version": { S: processingVersion },
            },
          },
        },
      ],
    })
  );

  return {
    job_id: jobId,
    status: "PROCESSING_AI",
    vision_handoff_state: "PENDING",
    transcript_key: transcriptKey,
  };
}

module.exports = { stageVisionResult };