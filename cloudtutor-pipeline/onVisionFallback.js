const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

const { describeFrame } = require("./geminiVision");
const { selectVisionFrames } = require("./selectVisionFrames");
const { checkVisionJob } = require("./visionJobCheck");

const s3 = new S3Client({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

const bucket = process.env.MEDIA_BUCKET;

async function readFrame(frameKey) {
  const result = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: frameKey,
    })
  );

  if (!result.Body) {
    throw new Error("Frame khong co noi dung");
  }

  if (result.ContentLength > 4 * 1024 * 1024) {
    throw new Error("Frame vuot gioi han 4 MB");
  }

  const bytes = await result.Body.transformToByteArray();

  if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024) {
    throw new Error("Kich thuoc frame khong hop le");
  }

  return bytes;
}

async function processVision(event) {
  if (!bucket) {
    throw new Error("Thieu bien moi truong MEDIA_BUCKET");
  }

  // Event thử trực tiếp. Chưa phải event nhận từ SQS.
  const ownerId = event?.owner_id;
  const jobId = event?.job_id;
  const processingVersion = event?.processing_version;
  const duration = Number(event?.duration_seconds);
  const interval = Number(event?.frame_interval_seconds);

  // Kiểm tra job trước khi đọc ảnh hoặc gọi Gemini.
  const jobCheck = await checkVisionJob({
    jobId,
    ownerId,
    processingVersion,
  });

  if (!jobCheck.allowed) {
    if (jobCheck.reason === "JOB_DELETED") {
      console.log("Bo qua Vision vi job dang xoa hoac da xoa:", jobId);

      return {
        skipped: true,
        job_id: jobId,
        reason: jobCheck.reason,
      };
    }

    throw new Error(`Khong the xu ly job Vision: ${jobCheck.reason}`);
  }

  // Giới hạn 3 ảnh cho lần kiểm thử này.
  const maxFrames = 1;

  console.log("Dang tim frame cho job:", jobId);

  const frames = await selectVisionFrames({
    bucket,
    ownerId,
    jobId,
    interval,
    duration,
    maxFrames,
  });

  console.log("So frame duoc chon:", frames.length);

  const segments = [];
  const usage = [];

  for (const frame of frames) {
    const start = frame.index * interval;
    const end = Math.min(start + interval, duration);

    console.log("Dang xu ly frame:", frame.key);

    const imageBytes = await readFrame(frame.key);
    const result = await describeFrame(imageBytes);

    segments.push({
      start_time: start,
      end_time: end,
      text: result.text,
      source: "VISION",
      frame_key: frame.key,
    });

    usage.push({
      frame_key: frame.key,
      usage: result.usage,
    });
  }

    const output = {
    schema_version: "1.0",
    test: "VISION_S3_SAVE_TEST",
    job_id: jobId,
    owner_id: ownerId,
    source: "VISION",
    text: segments.map((segment) => segment.text).join("\n\n"),
    segments,
    selected_frame_count: frames.length,
    frame_interval_seconds: interval,
    duration_seconds: duration,
    usage,
    warnings: [
      "AI_GENERATED_VISUAL_DESCRIPTION",
      "VISION_TIMESTAMPS_ARE_SAMPLED",
    ],
  };

  // Tên riêng cho lần thử; không ghi đè ASR/OCR.
  const outputKey =
    `results/${ownerId}/${jobId}/vision-save-test.json`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: outputKey,
      ContentType: "application/json",
      Body: JSON.stringify(output, null, 2),
    })
  );

  console.log("Da luu ket qua Vision thu nghiem:", outputKey);

  return {
    test: "VISION_S3_SAVE_TEST",
    bucket,
    output_key: outputKey,
    selected_frame_count: frames.length,
    warnings: output.warnings,
  };
};

exports.handler = async (event) => {
  if (!Array.isArray(event?.Records) || event.Records.length === 0) {
    throw new Error("Event khong co SQS Records");
  }

  for (const record of event.Records) {
    if (record.eventSource !== "aws:sqs") {
      throw new Error("Event khong phai tu SQS");
    }

    let message;

    try {
      message = JSON.parse(record.body);
    } catch {
      throw new Error("SQS message body khong phai JSON hop le");
    }

    const result = await processVision(message);

    console.log("Ket qua xu ly message Vision:", {
      message_id: record.messageId,
      job_id: message.job_id,
      skipped: result.skipped || false,
      reason: result.reason || null,
      output_key: result.output_key || null,
    });
  }

  return { statusCode: 200 };
};