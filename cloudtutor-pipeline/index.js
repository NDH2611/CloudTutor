const { randomUUID } = require("node:crypto");

const {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");

const {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
} = require("@aws-sdk/client-transcribe");

const region = process.env.AWS_REGION || "ap-southeast-1";

const dynamodb = new DynamoDBClient({ region });
const transcribe = new TranscribeClient({ region });

const jobsTable =
  process.env.JOBS_TABLE || "ddb-cloudtutor-jobs";

async function readJob(jobId) {
  const response = await dynamodb.send(
    new GetItemCommand({
      TableName: jobsTable,
      Key: {
        job_id: { S: jobId },
      },
      ConsistentRead: true,
    })
  );

  return response.Item || null;
}

/**
 * Tạo phiên xử lý ASR cho job mới.
 * Phiên và tên Transcribe được ghi trước khi gọi dịch vụ.
 */
async function prepareAsrJob({
  jobId,
  ownerId,
  videoKey,
}) {
  const job = await readJob(jobId);

  if (!job) {
    throw new Error(`Khong tim thay job trong DynamoDB: ${jobId}`);
  }

  if (
    job.owner_id?.S !== ownerId ||
    job.video_key?.S !== videoKey
  ) {
    throw new Error("Owner hoac video_key khong khop job");
  }

  const status = job.status?.S;

  if (status === "DELETING" || status === "DELETED") {
    return {
      skipped: true,
      reason: "JOB_DELETED",
    };
  }

  // Nếu nhận lại message khi đang xử lý ASR, sử dụng
  // phiên và tên Transcribe đã ghi từ lần trước.
  if (status === "PROCESSING_ASR") {
    const processingVersion = job.processing_version?.S;
    const transcriptionJobName = job.transcription_job_name?.S;

    if (!processingVersion || !transcriptionJobName) {
      throw new Error(
        "Job PROCESSING_ASR thieu version hoac ten Transcribe"
      );
    }

    return {
      skipped: false,
      processingVersion,
      transcriptionJobName,
    };
  }

  // Một event upload cũ có thể được nhận lại sau khi job
  // đã tiến đến bước sau. Không khởi động lại ASR.
  if (
    [
      "PROCESSING_OCR",
      "PROCESSING_VISION",
      "PROCESSING_AI",
      "COMPLETED",
      "COMPLETED_WITH_WARNING",
      "FAILED",
    ].includes(status)
  ) {
    return {
      skipped: true,
      reason: `JOB_ALREADY_ADVANCED_${status}`,
    };
  }

  if (status !== "CREATED" && status !== "UPLOADED") {
    throw new Error(`Trang thai job khong hop le: ${status}`);
  }

  // Tránh tự ghi đè version đã có từ một cơ chế xử lý khác.
  if (job.processing_version) {
    throw new Error("Job moi da co processing_version; can doi soat");
  }

  const processingVersion = randomUUID();

  const transcriptionJobName =
    `transcribe-cloudtutor-${jobId}-${processingVersion}`;

  if (
    transcriptionJobName.length > 200 ||
    !/^[a-zA-Z0-9._-]+$/.test(transcriptionJobName)
  ) {
    throw new Error("Ten Transcribe job khong hop le");
  }

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: jobsTable,

      Key: {
        job_id: { S: jobId },
      },

      ConditionExpression:
        "#owner = :owner AND #video = :video " +
        "AND #status IN (:created, :uploaded) " +
        "AND attribute_not_exists(#version)",

      UpdateExpression:
        "SET #status = :processing, #version = :version, " +
        "#transcribeName = :transcribeName, #updated = :now",

      ExpressionAttributeNames: {
        "#owner": "owner_id",
        "#video": "video_key",
        "#status": "status",
        "#version": "processing_version",
        "#transcribeName": "transcription_job_name",
        "#updated": "updated_at",
      },

      ExpressionAttributeValues: {
        ":owner": { S: ownerId },
        ":video": { S: videoKey },
        ":created": { S: "CREATED" },
        ":uploaded": { S: "UPLOADED" },
        ":processing": { S: "PROCESSING_ASR" },
        ":version": { S: processingVersion },
        ":transcribeName": { S: transcriptionJobName },
        ":now": { S: new Date().toISOString() },
      },
    })
  );

  return {
    skipped: false,
    processingVersion,
    transcriptionJobName,
  };
}

/**
 * Nếu Transcribe báo trùng tên, kiểm tra job đã có
 * trỏ đúng video trước khi xem đó là lần nhận lại.
 */
async function startTranscribe({
  transcriptionJobName,
  mediaUri,
}) {
  try {
    await transcribe.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: transcriptionJobName,
        LanguageCode: process.env.TRANSCRIBE_LANGUAGE || "en-US",
        Media: {
          MediaFileUri: mediaUri,
        },
        MediaFormat: "mp4",
      })
    );

    console.log("Da bat dau Transcribe:", transcriptionJobName);
  } catch (err) {
    if (err.name !== "ConflictException") {
      throw err;
    }

    const existing = await transcribe.send(
      new GetTranscriptionJobCommand({
        TranscriptionJobName: transcriptionJobName,
      })
    );

    if (existing.TranscriptionJob?.Media?.MediaFileUri !== mediaUri) {
      throw new Error("Transcribe job trung ten nhung khac video");
    }

    console.log(
      "Transcribe job da ton tai va trung video:",
      transcriptionJobName
    );
  }
}

exports.handler = async (event) => {
  const mediaBucket = process.env.MEDIA_BUCKET;

  if (!mediaBucket) {
    throw new Error("Thieu MEDIA_BUCKET");
  }

  for (const record of event.Records || []) {
    const body = JSON.parse(record.body);

    if (body.Event === "s3:TestEvent") {
      console.log("Bo qua su kien kiem tra S3");
      continue;
    }

    if (!Array.isArray(body.Records)) {
      throw new Error("Message khong dung dinh dang S3 notification");
    }

    for (const s3Record of body.Records) {
      const bucket = s3Record.s3?.bucket?.name;
      const encodedKey = s3Record.s3?.object?.key;

      if (typeof encodedKey !== "string") {
        throw new Error("S3 event thieu object key");
      }

      const key = decodeURIComponent(encodedKey.replace(/\+/g, " "));

      if (bucket !== mediaBucket) {
        throw new Error(`Bucket khong hop le: ${bucket}`);
      }

      const parts = key.split("/");
      const [folder, ownerId, jobId, filename] = parts;

      if (
        parts.length !== 4 ||
        folder !== "videos" ||
        !ownerId ||
        !jobId ||
        !/\.mp4$/i.test(filename)
      ) {
        throw new Error(`Video key khong hop le: ${key}`);
      }

      const prepared = await prepareAsrJob({
        jobId,
        ownerId,
        videoKey: key,
      });

      if (prepared.skipped) {
        console.log("Bo qua video event:", {
          job_id: jobId,
          reason: prepared.reason,
        });

        continue;
      }

      await startTranscribe({
        transcriptionJobName: prepared.transcriptionJobName,
        mediaUri: `s3://${bucket}/${key}`,
      });
    }
  }

  return { statusCode: 200 };
};