const {
  S3Client,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");

const { describeFrame } = require("./geminiVision");
const { selectVisionFrames } = require("./selectVisionFrames");

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

exports.handler = async (event) => {
  if (!bucket) {
    throw new Error("Thieu bien moi truong MEDIA_BUCKET");
  }

  // Event thử trực tiếp. Chưa phải event nhận từ SQS.
  const ownerId = event?.owner_id;
  const jobId = event?.job_id;
  const duration = Number(event?.duration_seconds);
  const interval = Number(event?.frame_interval_seconds);

  // Giới hạn 3 ảnh cho lần kiểm thử này.
  const maxFrames = 3;

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

  return {
    test: "VISION_AUTO_SELECT_TEST",
    job_id: jobId,
    owner_id: ownerId,
    source: "VISION",
    selected_frame_count: frames.length,
    segments,
    usage,
    warnings: [
      "AI_GENERATED_VISUAL_DESCRIPTION",
      "VISION_TIMESTAMPS_ARE_SAMPLED",
    ],
  };
};