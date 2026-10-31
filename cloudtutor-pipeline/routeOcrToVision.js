const {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");

const { enqueueVisionFallback } = require("./enqueueVisionFallback");

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

async function readJob(tableName, jobId) {
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
 * Chuyển job từ OCR sang Vision rồi gửi message SQS.
 *
 * Event MediaConvert lặp lại:
 * - Nếu cùng MediaConvert job đã chuyển sang Vision, cho phép gửi lại.
 * - Nếu là MediaConvert job khác, không gửi.
 *
 * SQS có thể nhận message trùng; worker Vision vẫn phải xử lý trùng.
 */
async function routeOcrToVision({
  ownerId,
  jobId,
  processingVersion,
  mediaConvertJobId,
  durationSeconds,
  frameIntervalSeconds,
}) {
  if (
    typeof ownerId !== "string" || !ownerId ||
    typeof jobId !== "string" || !jobId ||
    typeof processingVersion !== "string" || !processingVersion ||
    typeof mediaConvertJobId !== "string" || !mediaConvertJobId
  ) {
    throw new Error("Thieu thong tin chuyen OCR sang Vision");
  }

  const tableName =
    process.env.JOBS_TABLE || "ddb-cloudtutor-jobs";

  const job = await readJob(tableName, jobId);

  if (!job) {
    throw new Error("Khong tim thay job trong DynamoDB");
  }

  if (job.owner_id?.S !== ownerId) {
    throw new Error("Owner OCR khong khop");
  }

  if (
    job.status?.S === "DELETING" ||
    job.status?.S === "DELETED"
  ) {
    console.log("Bo qua Vision vi job dang xoa hoac da xoa:", jobId);

    return {
      skipped: true,
      reason: "JOB_DELETED",
    };
  }

  if (job.processing_version?.S !== processingVersion) {
    throw new Error("Processing version OCR khong khop");
  }

  if (job.status?.S === "PROCESSING_OCR") {
    try {
      await dynamodb.send(
        new UpdateItemCommand({
          TableName: tableName,

          Key: {
            job_id: { S: jobId },
          },

          ConditionExpression:
            "#owner = :owner AND #status = :ocr " +
            "AND #version = :version",

          UpdateExpression:
            "SET #status = :vision, #updated = :now, " +
            "#mediaJob = :mediaJob",

          ExpressionAttributeNames: {
            "#owner": "owner_id",
            "#status": "status",
            "#version": "processing_version",
            "#updated": "updated_at",
            "#mediaJob": "vision_mediaconvert_job_id",
          },

          ExpressionAttributeValues: {
            ":owner": { S: ownerId },
            ":ocr": { S: "PROCESSING_OCR" },
            ":vision": { S: "PROCESSING_VISION" },
            ":version": { S: processingVersion },
            ":now": { S: new Date().toISOString() },
            ":mediaJob": { S: mediaConvertJobId },
          },
        })
      );
    } catch (err) {
      // Một event khác có thể vừa cập nhật job.
      // Báo lỗi để lượt xử lý được thử lại; không gửi vội.
      throw err;
    }
  } else if (
    job.status?.S === "PROCESSING_VISION" &&
    job.vision_mediaconvert_job_id?.S === mediaConvertJobId
  ) {
    console.log("Event OCR duoc nhan lai:", jobId);
  } else {
    throw new Error(
      `Job khong the chuyen sang Vision: ${job.status?.S || "UNKNOWN"}`
    );
  }

  const messageId = await enqueueVisionFallback({
    ownerId,
    jobId,
    processingVersion,
    durationSeconds,
    frameIntervalSeconds,
  });

  return {
    skipped: false,
    job_id: jobId,
    message_id: messageId,
  };
}

module.exports = { routeOcrToVision };