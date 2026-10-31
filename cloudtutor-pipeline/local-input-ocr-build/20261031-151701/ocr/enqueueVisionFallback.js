const {
  SQSClient,
  SendMessageCommand,
} = require("@aws-sdk/client-sqs");

const sqs = new SQSClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

/**
 * Gửi yêu cầu xử lý Vision.
 *
 * Chỉ gọi sau khi:
 * 1. Đã xác định OCR không có nội dung.
 * 2. Đã kiểm tra job và phiên xử lý.
 * 3. Job đã được chuyển sang PROCESSING_VISION.
 */
async function enqueueVisionFallback({
  ownerId,
  jobId,
  processingVersion,
  durationSeconds,
  frameIntervalSeconds,
}) {
  const queueUrl = process.env.VISION_QUEUE_URL;

  if (!queueUrl) {
    throw new Error("Thieu bien moi truong VISION_QUEUE_URL");
  }

  for (const [name, value] of [
    ["owner_id", ownerId],
    ["job_id", jobId],
    ["processing_version", processingVersion],
  ]) {
    if (
      typeof value !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(value)
    ) {
      throw new Error(`${name} khong hop le`);
    }
  }

  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    throw new Error("duration_seconds khong hop le");
  }

  if (
    !Number.isFinite(frameIntervalSeconds) ||
    frameIntervalSeconds <= 0
  ) {
    throw new Error("frame_interval_seconds khong hop le");
  }

  const message = {
    schema_version: "1.0",
    owner_id: ownerId,
    job_id: jobId,
    processing_version: processingVersion,
    duration_seconds: durationSeconds,
    frame_interval_seconds: frameIntervalSeconds,
  };

  const result = await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
    })
  );

  console.log("Da gui yeu cau Vision:", {
    job_id: jobId,
    processing_version: processingVersion,
    message_id: result.MessageId,
  });

  return result.MessageId;
}

module.exports = { enqueueVisionFallback };