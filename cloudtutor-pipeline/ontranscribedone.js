const {
  TranscribeClient,
  GetTranscriptionJobCommand,
} = require("@aws-sdk/client-transcribe");

const {
  S3Client,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

const { 
  publishTranscript 
} = require("./publishTranscript");

const { 
  startOcrFallback 
} = require("./startOcrFallback");

const region = process.env.AWS_REGION || "ap-southeast-1";
const transcribeClient = new TranscribeClient({ region });
const s3Client = new S3Client({ region });

async function fetchJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(`Khong doc duoc transcript: HTTP ${response.status}`);
  }

  return response.json();
}

function normalizeSegments(items) {
  const segments = [];
  let current = null;

  function flush() {
    if (current) {
      segments.push({
        ...current,
        source: "ASR",
      });
      current = null;
    }
  }

  for (const item of items) {
    const text = item.alternatives?.[0]?.content;
    if (!text) continue;

    if (item.type === "pronunciation") {
      const start = Number(item.start_time);
      const end = Number(item.end_time);

      if (!Number.isFinite(start) ||
          !Number.isFinite(end) ||
          end < start) {
        throw new Error("Timestamp ASR khong hop le");
      }

      // Tách khi có khoảng nghỉ dài hoặc đoạn đã dài 15 giây.
      if (current &&
          (start - current.end_time > 2 ||
           end - current.start_time > 15)) {
        flush();
      }

      if (!current) {
        current = {
          start_time: start,
          end_time: end,
          text,
        };
      } else {
        current.text += ` ${text}`;
        current.end_time = end;
      }
    } else if (item.type === "punctuation" && current) {
      current.text += text;
      if (/[.!?。！？]/.test(text)) flush();
    }
  }

  flush();
  return segments;
}

async function saveJson(bucket, key, value) {
  await s3Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: "application/json",
    Body: JSON.stringify(value, null, 2),
  }));
}

exports.handler = async (event) => {
  const jobName = event.detail?.TranscriptionJobName;

  if (!jobName) {
    throw new Error("Su kien thieu TranscriptionJobName");
  }

  if (!jobName.startsWith("transcribe-cloudtutor-")) {
    console.log("Bo qua job ngoai CloudTutor:", jobName);
    return;
  }

  const bucket = process.env.MEDIA_BUCKET;
  if (!bucket) throw new Error("Thieu MEDIA_BUCKET");

  const result = await transcribeClient.send(
    new GetTranscriptionJobCommand({
      TranscriptionJobName: jobName,
    })
  );

  const job = result.TranscriptionJob;
  if (!job) throw new Error("Khong co thong tin Transcribe job");

  // Lấy owner_id và job_id từ video gốc.
  const mediaUri = job.Media?.MediaFileUri || "";
  const prefix = `s3://${bucket}/`;

  if (!mediaUri.startsWith(prefix)) {
    throw new Error("Video khong thuoc MEDIA_BUCKET");
  }

  const parts = mediaUri.slice(prefix.length).split("/");
  const [folder, ownerId, jobId] = parts;

  if (parts.length !== 4 ||
      folder !== "videos" ||
      !ownerId ||
      !jobId ||
      jobName !== `transcribe-cloudtutor-${jobId}`) {
    throw new Error("Video key hoac job_id khong hop le");
  }

  const outputPrefix = `results/${ownerId}/${jobId}`;

  if (job.TranscriptionJobStatus === "FAILED") {
    await saveJson(bucket, `${outputPrefix}/asr-failure.json`, {
      job_id: jobId,
      owner_id: ownerId,
      transcription_job_name: jobName,
      status: "FAILED",
      failure_reason: job.FailureReason || "Unknown",
    });

    console.error("Transcribe that bai:", jobName, job.FailureReason);
    // Cảnh báo lỗi dịch vụ và cập nhật DynamoDB sẽ bổ sung sau.
    return { statusCode: 200 };
  }

  if (job.TranscriptionJobStatus !== "COMPLETED") {
    throw new Error("Transcribe chua hoan tat");
  }

  const uri = job.Transcript?.TranscriptFileUri;
  if (!uri) throw new Error("Thieu TranscriptFileUri");

  const raw = await fetchJson(uri);
  const text = raw.results?.transcripts?.[0]?.transcript;
  const items = raw.results?.items;

  if (typeof text !== "string" || !Array.isArray(items)) {
    throw new Error("Output ASR khong dung dinh dang");
  }

  const segments = normalizeSegments(items);

  if (text.trim() && segments.length === 0) {
    throw new Error("Co van ban nhung khong co timestamp");
  }

  const normalized = {
    schema_version: "1.0",
    job_id: jobId,
    owner_id: ownerId,
    transcription_job_name: jobName,
    source: "ASR",
    text,
    segments,
    needs_ocr: !text.trim(),
    warnings: text.trim() ? [] : ["ASR_EMPTY"],
  };

  await saveJson(bucket, `${outputPrefix}/asr-output.json`, raw);
  await saveJson(
    bucket,
    `${outputPrefix}/normalized-transcript.json`,
    normalized
  );

  console.log("Da luu ket qua:", outputPrefix);
  console.log("So doan:", segments.length, "Can OCR:", normalized.needs_ocr);

  if (!normalized.needs_ocr) {
    await publishTranscript({
      bucket,
      key: `${outputPrefix}/normalized-transcript.json`,
      jobId,
      ownerId,
      source: "ASR",
    });
  } else {
    console.log("ASR rong: bat dau OCR fallback");

    const mediaConvertJobId = await startOcrFallback({
      bucket,
      videoKey: mediaUri.slice(prefix.length),
      ownerId,
      jobId,
    });

    await saveJson(bucket, `${outputPrefix}/ocr-job.json`, {
      job_id: jobId,
      owner_id: ownerId,
      mediaconvert_job_id: mediaConvertJobId,
      status: "SUBMITTED",
    });
  }

  return { statusCode: 200 };
};