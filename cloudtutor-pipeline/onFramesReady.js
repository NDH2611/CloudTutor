// M2_INPUT_OCR_V1
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
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");

const { 
  publishTranscript 
} = require("./publishTranscript");

const { stageTextResult } = require("./stageTextResult");
const { dispatchTextHandoff } = require("./dispatchTextHandoff");
const { recoverTextHandoff } = require("./recoverTextHandoff");
const { routeOcrToVision } = require("./routeOcrToVision");
const { comparisonKey, buildFrameText, selectOcrLines } = require("./ocrText");

const region = process.env.AWS_REGION || "ap-southeast-1";
const s3 = new S3Client({ region });
const rekognition = new RekognitionClient({ region });
const dynamodb = new DynamoDBClient({ region });
const jobsTable = process.env.JOBS_TABLE || "ddb-cloudtutor-jobs";
async function saveJson(bucket, key, value) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: "application/json",
    Body: JSON.stringify(value, null, 2),
  }));
}

/**
 * Xử lý lỗi MediaConvert của đúng phiên OCR.
 *
 * Nếu Completion chưa kịp ghi MediaConvert ID, báo lỗi để có
 * thể thử lại. Không tự đánh dấu FAILED khi chưa đối chiếu được.
 */
async function handleMediaConvertError({
  jobId,
  ownerId,
  processingVersion,
  mediaConvertJobId,
  errorMessage,
}) {
  const response = await dynamodb.send(
    new GetItemCommand({
      TableName: jobsTable,
      Key: {
        job_id: { S: jobId },
      },
      ConsistentRead: true,
    })
  );

  const job = response.Item;

  if (!job) {
    throw new Error("Khong tim thay job OCR trong DynamoDB");
  }

  if (
    job.owner_id?.S !== ownerId ||
    job.processing_version?.S !== processingVersion
  ) {
    throw new Error("Owner hoac processing version OCR khong khop");
  }

  const status = job.status?.S;

  if (status === "DELETING" || status === "DELETED") {
    return { skipped: true, reason: "JOB_DELETED" };
  }

  const storedMediaJobId = job.ocr_mediaconvert_job_id?.S;

  if (!storedMediaJobId) {
    throw new Error(
      "Chua co ocr_mediaconvert_job_id de doi chieu event ERROR"
    );
  }

  if (storedMediaJobId !== mediaConvertJobId) {
    return { skipped: true, reason: "OTHER_MEDIACONVERT_JOB" };
  }

  if (
    status === "FAILED" &&
    job.error_code?.S === "MEDIACONVERT_FAILED"
  ) {
    return { skipped: true, reason: "ERROR_ALREADY_RECORDED" };
  }

  if (status !== "PROCESSING_OCR") {
    return { skipped: true, reason: `JOB_ALREADY_${status}` };
  }

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: jobsTable,

      Key: {
        job_id: { S: jobId },
      },

      ConditionExpression:
        "#owner = :owner AND #version = :version " +
        "AND #status = :ocr AND #mediaJob = :mediaJob",

      UpdateExpression:
        "SET #status = :failed, #error = :error, " +
        "#message = :message, #updated = :now",

      ExpressionAttributeNames: {
        "#owner": "owner_id",
        "#version": "processing_version",
        "#status": "status",
        "#mediaJob": "ocr_mediaconvert_job_id",
        "#error": "error_code",
        "#message": "error_message",
        "#updated": "updated_at",
      },

      ExpressionAttributeValues: {
        ":owner": { S: ownerId },
        ":version": { S: processingVersion },
        ":ocr": { S: "PROCESSING_OCR" },
        ":mediaJob": { S: mediaConvertJobId },
        ":failed": { S: "FAILED" },
        ":error": { S: "MEDIACONVERT_FAILED" },
        ":message": {
          S: String(errorMessage || "MediaConvert failed").slice(0, 500),
        },
        ":now": { S: new Date().toISOString() },
      },
    })
  );

  return { skipped: false, reason: "MEDIACONVERT_FAILED" };
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
    const processingVersion = metadata.processing_version;

    if (
      typeof processingVersion !== "string" ||
      !processingVersion ||
      typeof detail.jobId !== "string" ||
      !detail.jobId
    ) {
      throw new Error("Event ERROR thieu processing_version hoac jobId");
    }

    const result = await handleMediaConvertError({
      jobId,
      ownerId,
      processingVersion,
      mediaConvertJobId: detail.jobId,
      errorMessage: detail.errorMessage,
    });

    console.error("MediaConvert ERROR:", {
      job_id: jobId,
      mediaconvert_job_id: detail.jobId,
      error_code: detail.errorCode || null,
      result,
    });

    return { statusCode: 200 };
  }

  if (detail.status !== "COMPLETE") return;
    const processingVersion = metadata.processing_version;

  if (!processingVersion) {
    throw new Error("MediaConvert metadata thieu processing_version");
  }

  if (typeof detail.jobId !== "string" || !detail.jobId) {
    throw new Error("MediaConvert event thieu jobId");
  }

  // Đối chiếu COMPLETE với MediaConvert job thuộc phiên hiện tại.
  const jobResponse = await dynamodb.send(
    new GetItemCommand({
      TableName: jobsTable,
      Key: {
        job_id: { S: jobId },
      },
      ConsistentRead: true,
    })
  );

  const currentJob = jobResponse.Item;

  if (!currentJob) {
    throw new Error("Khong tim thay job OCR trong DynamoDB");
  }

  if (
    currentJob.owner_id?.S !== ownerId ||
    currentJob.processing_version?.S !== processingVersion
  ) {
    throw new Error("Owner hoac processing version OCR khong khop");
  }

  if (
    currentJob.status?.S === "DELETING" ||
    currentJob.status?.S === "DELETED"
  ) {
    console.log("Bo qua COMPLETE vi job dang xoa hoac da xoa:", jobId);
    return { statusCode: 200 };
  }

  const currentMediaJobId = currentJob.ocr_mediaconvert_job_id?.S;

  if (!currentMediaJobId) {
    // Completion có thể chưa kịp ghi ID. Không xử lý vội.
    throw new Error(
      "Chua co ocr_mediaconvert_job_id de doi chieu event COMPLETE"
    );
  }

  if (currentMediaJobId !== detail.jobId) {
    console.log("Bo qua COMPLETE cua MediaConvert job khac:", {
      job_id: jobId,
      event_media_job_id: detail.jobId,
      current_media_job_id: currentMediaJobId,
    });

    return { statusCode: 200 };
  }

  const recovery = await recoverTextHandoff({
    jobId,
    ownerId,
    processingVersion,
    bucket,
    source: "OCR",
  });

  if (
    recovery.action !== "PROCESS" &&
    recovery.action !== "RECOVER_VISION"
  ) {
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

  if (recovery.action === "RECOVER_VISION") {
    const visionResult = await routeOcrToVision({
      ownerId,
      jobId,
      processingVersion,
      mediaConvertJobId: detail.jobId,
      durationSeconds: duration,
      frameIntervalSeconds: interval,
    });

    console.log("Da phuc hoi ban giao Vision:", visionResult);
    return { statusCode: 200 };
  }

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

    const lines = selectOcrLines(response.TextDetections);

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
  "OCR_LANGUAGE_SUPPORT_LIMITED",
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
