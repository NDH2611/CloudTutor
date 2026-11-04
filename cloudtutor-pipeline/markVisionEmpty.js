const {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

const jobsTable = process.env.JOBS_TABLE || "ddb-cloudtutor-jobs";

/**
 * Kiểm tra message chạy lại sau khi đã xác định Vision không có nội dung.
 */
async function isVisionEmptyAlreadyRecorded({
  jobId,
  ownerId,
  processingVersion,
}) {
  const result = await dynamodb.send(
    new GetItemCommand({
      TableName: jobsTable,
      Key: {
        job_id: { S: jobId },
      },
      ConsistentRead: true,
    })
  );

  const item = result.Item;

  return Boolean(
    item &&
    item.owner_id?.S === ownerId &&
    item.processing_version?.S === processingVersion &&
    item.status?.S === "FAILED" &&
    [
      "VISION_NO_USEFUL_SAMPLED_FRAMES",
      "VISION_NO_USEFUL_CONTENT",
    ].includes(item.error_code?.S)  );
}

/**
 * Chỉ đánh dấu thất bại khi job vẫn thuộc phiên Vision hiện tại.
 */
async function markVisionEmpty({
  jobId,
  ownerId,
  processingVersion,
}) {
  await dynamodb.send(
    new UpdateItemCommand({
      TableName: jobsTable,

      Key: {
        job_id: { S: jobId },
      },

      ConditionExpression:
        "#owner = :owner AND #version = :version AND #status = :vision",

      UpdateExpression:
        "SET #status = :failed, #error = :error, #updated = :now",

      ExpressionAttributeNames: {
        "#owner": "owner_id",
        "#version": "processing_version",
        "#status": "status",
        "#error": "error_code",
        "#updated": "updated_at",
      },

      ExpressionAttributeValues: {
        ":owner": { S: ownerId },
        ":version": { S: processingVersion },
        ":vision": { S: "PROCESSING_VISION" },
        ":failed": { S: "FAILED" },
	":error": { S: "VISION_NO_USEFUL_SAMPLED_FRAMES" },
        ":now": { S: new Date().toISOString() },
      },
    })
  );
}

module.exports = {
  isVisionEmptyAlreadyRecorded,
  markVisionEmpty,
};