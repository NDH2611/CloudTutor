const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

const { describeFrame } = require("./geminiVision");
const { selectVisionFrames } = require("./selectVisionFrames");
const { checkVisionJob } = require("./visionJobCheck");
const { recoverVisionHandoff } = require("./recoverVisionHandoff");
const { stageVisionResult } = require("./stageVisionResult");
const { dispatchVisionHandoff } = require("./dispatchVisionHandoff");

const {
  isVisionEmptyAlreadyRecorded,
  markVisionEmpty,
} = require("./markVisionEmpty");
const s3 = new S3Client({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

const bucket = process.env.MEDIA_BUCKET;
const MAX_FRAME_BYTES = 4 * 1024 * 1024;

/**
 * Chỉ chấp nhận thành phần ID an toàn để tạo S3 key.
 */
function validateIdentifier(value, name) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(value)
  ) {
    throw new Error(`${name} khong hop le`);
  }
}

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

  if (result.ContentLength > MAX_FRAME_BYTES) {
    throw new Error("Frame vuot gioi han 4 MB");
  }

  const bytes = await result.Body.transformToByteArray();

  if (bytes.length === 0 || bytes.length > MAX_FRAME_BYTES) {
    throw new Error("Kich thuoc frame khong hop le");
  }

  return bytes;
}

/**
 * Kiểm tra file Vision trước khi tái sử dụng.
 *
 * Kiểm tra schema không chứng minh mô tả của AI chính xác
 * hoặc hữu ích về mặt nội dung.
 */
function validateVisionOutput(
  output,
  { jobId, ownerId, processingVersion }
) {
  if (
    !output ||
    output.schema_version !== "1.0" ||
    output.job_id !== jobId ||
    output.owner_id !== ownerId ||
    output.processing_version !== processingVersion ||
    output.source !== "VISION"
  ) {
    throw new Error("Metadata file Vision khong khop job");
  }

  if (
    typeof output.text !== "string" ||
    !output.text.trim() ||
    !Array.isArray(output.segments) ||
    output.segments.length === 0
  ) {
    throw new Error("File Vision khong co noi dung hop le");
  }

  for (const segment of output.segments) {
    if (
      typeof segment.text !== "string" ||
      !segment.text.trim() ||
      !Number.isFinite(segment.start_time) ||
      !Number.isFinite(segment.end_time) ||
      segment.start_time < 0 ||
      segment.end_time <= segment.start_time ||
      segment.source !== "VISION"
    ) {
      throw new Error("Segment Vision khong hop le");
    }
  }
}

/**
 * Đọc file đã lưu. Chỉ trả null khi object không tồn tại.
 * Các lỗi khác, ví dụ AccessDenied, tiếp tục được báo lỗi.
 */
async function readExistingOutput(outputKey, identity) {
  try {
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: outputKey,
      })
    );

    if (!result.Body) {
      throw new Error("File Vision khong co noi dung");
    }

    const content = await result.Body.transformToString("utf-8");
    const output = JSON.parse(content);

    validateVisionOutput(output, identity);
    return output;
  } catch (err) {
    const isNotFound =
      err.name === "NoSuchKey" ||
      err.$metadata?.httpStatusCode === 404;

    if (isNotFound) {
      return null;
    }

    throw err;
  }
}

/**
 * Lưu file chỉ khi key chưa tồn tại.
 *
 * Nếu một lượt khác đã lưu trước, đọc lại file đó.
 */
async function saveOutputOnce(outputKey, output, identity) {
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: outputKey,
        ContentType: "application/json",
        Body: JSON.stringify(output, null, 2),
        IfNoneMatch: "*",
      })
    );

    console.log("Da luu file Vision moi:", outputKey);

    return output;
  } catch (err) {
    const isPreconditionFailed =
      err.name === "PreconditionFailed" ||
      err.$metadata?.httpStatusCode === 412;

    if (!isPreconditionFailed) {
      // Ví dụ lỗi mạng, AccessDenied hoặc xung đột 409:
      // báo lỗi để lượt xử lý được thử lại.
      throw err;
    }

    console.log("File Vision da ton tai, doc lai:", outputKey);

    const existing = await readExistingOutput(outputKey, identity);

    if (!existing) {
      throw new Error("File Vision vua ton tai nhung khong doc duoc");
    }

    return existing;
  }
}

async function processVision(event) {
  if (!bucket) {
    throw new Error("Thieu bien moi truong MEDIA_BUCKET");
  }

  const ownerId = event?.owner_id;
  const jobId = event?.job_id;
  const processingVersion = event?.processing_version;
  const duration = Number(event?.duration_seconds);
  const interval = Number(event?.frame_interval_seconds);

  validateIdentifier(ownerId, "owner_id");
  validateIdentifier(jobId, "job_id");
  validateIdentifier(processingVersion, "processing_version");

  const identity = {
    jobId,
    ownerId,
    processingVersion,
  };

    if (await isVisionEmptyAlreadyRecorded(identity)) {
    console.log("Vision rong da duoc ghi nhan truoc do:", jobId);

    return {
      skipped: true,
      job_id: jobId,
      reason: "VISION_NO_USEFUL_CONTENT",
    };
  }
  // Kiểm tra checkpoint trước khi đọc frame hoặc gọi Gemini.
  const recovery = await recoverVisionHandoff({
    ...identity,
    bucket,
  });

  if (recovery.action === "JOB_DELETED") {
    console.log("Bo qua Vision vi job dang xoa hoac da xoa:", jobId);

    return {
      skipped: true,
      job_id: jobId,
      reason: "JOB_DELETED",
    };
  }

  if (recovery.action === "HANDOFF_RECOVERED") {
    console.log("Checkpoint Vision da duoc xu ly:", {
      job_id: jobId,
      handoff_state: recovery.handoff_state,
      already_sent: recovery.already_sent,
    });

    return {
      skipped: true,
      job_id: jobId,
      reason: "HANDOFF_RECOVERED",
    };
  }

  if (recovery.action !== "PROCESS_VISION") {
    throw new Error("Ket qua khoi phuc Vision khong hop le");
  }

  const jobCheck = await checkVisionJob(identity);

  if (!jobCheck.allowed) {
    if (jobCheck.reason === "JOB_DELETED") {
      console.log("Bo qua Vision vi job dang xoa hoac da xoa:", jobId);

      return {
        skipped: true,
        job_id: jobId,
        reason: "JOB_DELETED",
      };
    }

    throw new Error(`Khong the xu ly job Vision: ${jobCheck.reason}`);
  }

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("duration_seconds khong hop le");
  }

  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error("frame_interval_seconds khong hop le");
  }

  // Tên file thử có version để không dùng nhầm kết quả phiên khác.
  const outputKey =
    `results/${ownerId}/${jobId}/vision-cache-v${processingVersion}.json`;

  let output = await readExistingOutput(outputKey, identity);

  if (output) {
    console.log("Su dung lai ket qua Vision da luu:", outputKey);
  } else {
    // Giữ 1 frame trong giai đoạn kiểm thử.
    const maxFrames = 3;

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

      usage.push({
        frame_key: frame.key,
        usage: result.usage,
      });

      if (!result.useful) {
        console.log("Frame khong co noi dung huu ich:", frame.key);
        continue;
      }

      segments.push({
        start_time: start,
        end_time: end,
        text: result.text,
        source: "VISION",
        frame_key: frame.key,
      });
    }
    if (segments.length === 0) {
      await markVisionEmpty(identity);

      console.log("Vision khong tim thay noi dung huu ich:", jobId);

      return {
        skipped: true,
        job_id: jobId,
        reason: "VISION_NO_USEFUL_CONTENT",
      };
    }
    output = {
      schema_version: "1.0",
      test: "VISION_CACHE_TEST",
      job_id: jobId,
      owner_id: ownerId,
      processing_version: processingVersion,
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

    validateVisionOutput(output, identity);

    output = await saveOutputOnce(
      outputKey,
      output,
      identity
    );
  }

  // Transaction chỉ thành công nếu job vẫn đang PROCESSING_VISION
  // và đúng owner/version.
  const checkpoint = await stageVisionResult({
    jobId,
    ownerId,
    processingVersion,
    transcriptKey: outputKey,
  });

  console.log("Da tao checkpoint Vision:", checkpoint);

  const handoff = await dispatchVisionHandoff({
    jobId,
    ownerId,
    processingVersion,
    bucket,
  });

  console.log("Da xu ly ban giao Vision:", {
    job_id: jobId,
    handoff_state: handoff.handoff_state,
    already_sent: handoff.already_sent,
    message_id: handoff.message_id || null,
  });

  return {
    job_id: jobId,
    output_key: outputKey,
    selected_frame_count: output.selected_frame_count,
  };
}

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