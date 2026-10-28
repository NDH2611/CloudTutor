const {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

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
 * Kiểm tra Transcribe job đang thuộc phiên xử lý nào.
 */
async function getAsrJobState({
  jobId,
  ownerId,
  videoKey,
  transcriptionJobName,
}) {
  const job = await readJob(jobId);

  if (!job) {
    throw new Error("Khong tim thay job trong DynamoDB");
  }

  if (
    job.owner_id?.S !== ownerId ||
    job.video_key?.S !== videoKey
  ) {
    throw new Error("Owner hoac video_key khong khop");
  }

  const status = job.status?.S;

  if (status === "DELETING" || status === "DELETED") {
    return {
      skipped: true,
      reason: "JOB_DELETED",
    };
  }

  const processingVersion = job.processing_version?.S;
  const storedTranscribeName = job.transcription_job_name?.S;

  if (!processingVersion || !storedTranscribeName) {
    throw new Error(
      "Job thieu processing_version hoac transcription_job_name"
    );
  }

  if (storedTranscribeName !== transcriptionJobName) {
    throw new Error("Transcribe event khong thuoc phien xu ly hien tai");
  }

  return {
    skipped: false,
    status,
    processingVersion,
  };
}

/**
 * Chuyển PROCESSING_ASR → PROCESSING_OCR.
 * Nếu event được nhận lại khi job vẫn đang PROCESSING_OCR,
 * giữ nguyên trạng thái để có thể thử khởi động OCR lại.
 */
async function markProcessingOcr({
  jobId,
  ownerId,
  videoKey,
  transcriptionJobName,
  processingVersion,
}) {
  const current = await getAsrJobState({
    jobId,
    ownerId,
    videoKey,
    transcriptionJobName,
  });

  if (current.skipped) {
    return current;
  }

  if (current.processingVersion !== processingVersion) {
    throw new Error("Processing version khong khop");
  }

  if (current.status === "PROCESSING_OCR") {
    return {
      skipped: false,
      alreadyOcr: true,
    };
  }

  if (current.status !== "PROCESSING_ASR") {
    throw new Error(
      `Khong the chuyen sang OCR tu trang thai: ${current.status}`
    );
  }

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: jobsTable,

      Key: {
        job_id: { S: jobId },
      },

      ConditionExpression:
        "#owner = :owner AND #video = :video " +
        "AND #status = :asr AND #version = :version " +
        "AND #transcribeName = :transcribeName",

      UpdateExpression:
        "SET #status = :ocr, #updated = :now",

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
        ":asr": { S: "PROCESSING_ASR" },
        ":ocr": { S: "PROCESSING_OCR" },
        ":version": { S: processingVersion },
        ":transcribeName": { S: transcriptionJobName },
        ":now": { S: new Date().toISOString() },
      },
    })
  );

  return {
    skipped: false,
    alreadyOcr: false,
  };
}

module.exports = {
  getAsrJobState,
  markProcessingOcr,
};