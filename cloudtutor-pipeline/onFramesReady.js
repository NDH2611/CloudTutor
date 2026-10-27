const {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

const {
  RekognitionClient,
  DetectTextCommand,
} = require("@aws-sdk/client-rekognition");

const { 
  publishTranscript 
} = require("./publishTranscript");

const { stageTextResult } = require("./stageTextResult");
const { dispatchTextHandoff } = require("./dispatchTextHandoff");
const { recoverTextHandoff } = require("./recoverTextHandoff");
const { routeOcrToVision } = require("./routeOcrToVision");
// Chuẩn hóa để so sánh, vẫn giữ dấu tiếng Việt.
function comparisonKey(text) {
  return text
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Loại dòng giống nhau trong cùng một frame.
function buildFrameText(lines) {
  const seen = new Set();
  const texts = [];

  for (const line of lines) {
    const text = (line.DetectedText || "")
      .normalize("NFC")
      .replace(/\s+/g, " ")
      .trim();

    const key = comparisonKey(text);

    if (!key || seen.has(key)) continue;

    seen.add(key);
    texts.push(text);
  }

  return texts.join("\n");
}

const region = process.env.AWS_REGION || "ap-southeast-1";
const s3 = new S3Client({ region });
const rekognition = new RekognitionClient({ region });

async function saveJson(bucket, key, value) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: "application/json",
    Body: JSON.stringify(value, null, 2),
  }));
}

exports.handler = async (event) => {
  const detail = event.detail;
  const metadata = detail?.userMetadata;

  if (metadata?.project !== "cloudtutor" ||
      metadata?.stage !== "extract-frames") {
    console.log("Bo qua su kien ngoai pipeline OCR");
    return;
  }

  const bucket = process.env.MEDIA_BUCKET;
  const ownerId = metadata.owner_id;
  const jobId = metadata.job_id;
  const interval = Number(metadata.frame_interval_seconds);

  if (!bucket || !ownerId || !jobId ||
      /[\/\\]/.test(ownerId) || /[\/\\]/.test(jobId) ||
      !Number.isFinite(interval) || interval <= 0) {
    throw new Error("Cau hinh hoac metadata OCR khong hop le");
  }

  const resultPrefix = `results/${ownerId}/${jobId}`;

  if (detail.status === "ERROR") {
    await saveJson(bucket, `${resultPrefix}/ocr-failure.json`, {
      job_id: jobId,
      owner_id: ownerId,
      mediaconvert_job_id: detail.jobId,
      status: "FAILED",
      error_code: detail.errorCode,
      error_message: detail.errorMessage,
    });

    // Làm Lambda báo lỗi để alarm Errors hiện có thể áp dụng.
    throw new Error(`MediaConvert failed: ${detail.errorMessage}`);
  }

  if (detail.status !== "COMPLETE") return;
    const processingVersion = metadata.processing_version;

  if (!processingVersion) {
    throw new Error("MediaConvert metadata thieu processing_version");
  }

  const recovery = await recoverTextHandoff({
    jobId,
    ownerId,
    processingVersion,
    bucket,
    source: "OCR",
  });

  if (recovery.action !== "PROCESS") {
    console.log("Bo qua hoac khoi phuc OCR:", recovery);
    return { statusCode: 200 };
  }

    // Chỉ lấy thời lượng video MP4 phụ, bỏ thời lượng nhóm ảnh.
  const derivedPrefix =
    `s3://${bucket}/derived/${ownerId}/${jobId}/`;

  const videoOutputs = (detail.outputGroupDetails || [])
    .flatMap(group => group.outputDetails || [])
    .filter(output =>
      (output.outputFilePaths || []).some(path =>
        path.startsWith(derivedPrefix) &&
        /\.mp4$/i.test(path)
      )
    );

  if (videoOutputs.length !== 1) {
    throw new Error("Khong xac dinh duoc duy nhat video derived");
  }

  const duration = Number(videoOutputs[0].durationInMs) / 1000;

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Thoi luong video derived khong hop le");
  }

  console.log("Thoi luong video:", duration);
  const prefix = `frames/${ownerId}/${jobId}/`;
  const frames = [];
  let token;

  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: token,
    }));

    for (const object of page.Contents || []) {
      const match = object.Key.match(/_frame\.(\d{7})\.jpg$/);
      if (match) {
        frames.push({
          key: object.Key,
          index: Number(match[1]),
        });
      }
    }

    token = page.NextContinuationToken;
  } while (token);

  frames.sort((a, b) => a.index - b.index);

  if (frames.length === 0) throw new Error("Khong tim thay frame");
  if (frames.length > 60) {
    throw new Error("Vuot gioi han 60 frame cua ban OCR test");
  }

  const segments = [];
  const rawFrames = [];

  for (const frame of frames) {
    const response = await rekognition.send(new DetectTextCommand({
      Image: {
        S3Object: {
          Bucket: bucket,
          Name: frame.key,
        },
      },
    }));

    // Lưu phản hồi gốc để kiểm tra chữ bị bỏ do confidence thấp.
    rawFrames.push({
      frame_key: frame.key,
      timestamp: frame.index * interval,
      detections: response.TextDetections || [],
    });

    const lines = (response.TextDetections || [])
      .filter(item => item.Type === "LINE" && item.Confidence >= 80)
      .sort((a, b) =>
        a.Geometry.BoundingBox.Top - b.Geometry.BoundingBox.Top ||
        a.Geometry.BoundingBox.Left - b.Geometry.BoundingBox.Left
      );

    const text = buildFrameText(lines);
    const start = frame.index * interval;
    const end = Math.min(start + interval, duration);

    if (!text || start >= duration) continue;

    // Gộp chữ giống hệt nhau ở các frame liên tiếp.
    const previous = segments[segments.length - 1];

    if (
      previous &&
      comparisonKey(previous.text) === comparisonKey(text) &&
      Math.abs(previous.end_time - start) < 0.01
    ) {
      previous.end_time = end;
    } else {
      segments.push({
        start_time: start,
        end_time: end,
        text,
        source: "OCR",
      });
    }

    console.log("Da OCR frame:", frame.key);
  }

const warnings = [
  "OCR_TIMESTAMPS_ARE_SAMPLED",
  "OCR_TEXT_REQUIRES_REVIEW",
];
  if (duration > (frames[frames.length - 1].index + 1) * interval) {
    warnings.push("FRAME_COVERAGE_TRUNCATED");
  }
  if (segments.length === 0) warnings.push("OCR_EMPTY");

  const normalized = {
    schema_version: "1.0",
    job_id: jobId,
    owner_id: ownerId,
    processing_version: processingVersion,
    mediaconvert_job_id: detail.jobId,
    source: "OCR",
    text: segments.map(segment => segment.text).join("\n\n"),
    segments,
    frame_interval_seconds: interval,
    frame_count: frames.length,
    duration_seconds: duration,
    needs_vision: segments.length === 0,
    warnings,
  };

  await saveJson(bucket, `${resultPrefix}/ocr-output.json`, {
    job_id: jobId,
    owner_id: ownerId,
    frames: rawFrames,
  });

  await saveJson(
    bucket,
    `${resultPrefix}/normalized-ocr.json`,
    normalized
  );

  console.log("Da luu OCR:", resultPrefix);
  console.log("So doan:", segments.length);

  if (normalized.text.trim() && normalized.segments.length > 0) {
    const transcriptKey = `${resultPrefix}/normalized-ocr.json`;

    await stageTextResult({
      jobId,
      ownerId,
      processingVersion,
      transcriptKey,
      source: "OCR",
    });

    await dispatchTextHandoff({
      jobId,
      ownerId,
      processingVersion,
      bucket,
      source: "OCR",
    });

    console.log("Da ban giao transcript OCR:", jobId);
  } else {
    console.log("OCR rong: chuyen sang Vision fallback");

    if (!processingVersion) {
      throw new Error(
        "MediaConvert metadata thieu processing_version"
      );
    }

    const visionResult = await routeOcrToVision({
      ownerId,
      jobId,
      processingVersion,
      mediaConvertJobId: detail.jobId,
      durationSeconds: duration,
      frameIntervalSeconds: interval,
    });

    console.log("Ket qua chuyen Vision:", visionResult);
  }

  return { statusCode: 200 };
};