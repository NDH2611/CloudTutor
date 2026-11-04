const {
  DynamoDBClient,
  TransactWriteItemsCommand,
} = require("@aws-sdk/client-dynamodb");

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

/**
 * Tạo checkpoint bàn giao transcript ASR hoặc OCR.
 *
 * Transcript phải được lưu S3 trước khi gọi hàm này.
 * Hàm không gửi SQS.
 */
async function stageTextResult({
  jobId,
  ownerId,
  processingVersion,
  transcriptKey,
  source,
}) {
  if (
    typeof jobId !== "string" || !jobId ||
    typeof ownerId !== "string" || !ownerId ||
    typeof processingVersion !== "string" || !processingVersion ||
    typeof transcriptKey !== "string" || !transcriptKey
  ) {
    throw new Error("Thieu thong tin checkpoint transcript");
  }

  const expectedStatusBySource = {
    ASR: "PROCESSING_ASR",
    OCR: "PROCESSING_OCR",
  };

  const expectedStatus = expectedStatusBySource[source];

  if (!expectedStatus) {
    throw new Error("Source phai la ASR hoac OCR");
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

            ConditionExpression:
              "#owner = :owner AND #status = :expectedStatus " +
              "AND #version = :version",

            UpdateExpression:
              "SET #status = :ai, #updated = :now, " +
              "#handoff = :pending",

            ExpressionAttributeNames: {
              "#owner": "owner_id",
              "#status": "status",
              "#version": "processing_version",
              "#updated": "updated_at",
              "#handoff": "text_handoff_state",
            },

            ExpressionAttributeValues: {
              ":owner": { S: ownerId },
              ":expectedStatus": { S: expectedStatus },
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

            // Không ghi đè tham chiếu của nguồn hoặc phiên khác.
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
              ":source": { S: source },
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
    text_handoff_state: "PENDING",
    transcript_key: transcriptKey,
    source,
  };
}

module.exports = { stageTextResult };