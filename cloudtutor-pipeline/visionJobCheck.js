const {
  DynamoDBClient,
  GetItemCommand,
} = require("@aws-sdk/client-dynamodb");

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

/**
 * Đọc job trước khi xử lý Vision.
 *
 * Kết quả:
 * - { allowed: true }: job đúng owner, version và trạng thái.
 * - { allowed: false, reason: ... }: không xử lý message này.
 *
 * Lỗi truy cập DynamoDB sẽ được ném ra để cơ chế retry xử lý.
 */
async function checkVisionJob({
  jobId,
  ownerId,
  processingVersion,
}) {
  const tableName =
    process.env.JOBS_TABLE || "ddb-cloudtutor-jobs";

  if (
    typeof jobId !== "string" ||
    !jobId ||
    typeof ownerId !== "string" ||
    !ownerId ||
    typeof processingVersion !== "string" ||
    !processingVersion
  ) {
    throw new Error("Thieu job_id, owner_id hoac processing_version");
  }

  const response = await dynamodb.send(
    new GetItemCommand({
      TableName: tableName,
      Key: {
        job_id: { S: jobId },
      },
      ConsistentRead: true,
    })
  );

  const item = response.Item;

  if (!item) {
    return {
      allowed: false,
      reason: "JOB_NOT_FOUND",
    };
  }

  const jobOwnerId = item.owner_id?.S;
  const status = item.status?.S;
  const jobVersion = item.processing_version?.S;

  if (jobOwnerId !== ownerId) {
    return {
      allowed: false,
      reason: "OWNER_MISMATCH",
    };
  }

  if (status === "DELETING" || status === "DELETED") {
    return {
      allowed: false,
      reason: "JOB_DELETED",
    };
  }

  if (jobVersion !== processingVersion) {
    return {
      allowed: false,
      reason: "PROCESSING_VERSION_MISMATCH",
    };
  }

  if (status !== "PROCESSING_VISION") {
    return {
      allowed: false,
      reason: "STATUS_NOT_PROCESSING_VISION",
      status: status || null,
    };
  }

  return {
    allowed: true,
    status,
  };
}

module.exports = { checkVisionJob };