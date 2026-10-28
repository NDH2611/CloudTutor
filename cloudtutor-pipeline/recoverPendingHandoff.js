const {
  DynamoDBClient,
  GetItemCommand,
} = require("@aws-sdk/client-dynamodb");

const { dispatchTextHandoff } = require("./dispatchTextHandoff");
const { dispatchVisionHandoff } = require("./dispatchVisionHandoff");

const db = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

async function read(table, jobId) {
  const response = await db.send(new GetItemCommand({
    TableName: table,
    Key: { job_id: { S: jobId } },
    ConsistentRead: true,
  }));
  return response.Item;
}

/**
 * Phục hồi thủ công checkpoint trên job thử.
 * Mặc định chỉ kiểm tra, không gửi message.
 * Chưa phải bộ reconcile tự động hoặc khóa chống chạy đồng thời.
 */
async function recoverPendingHandoff({ jobId, apply = false }) {
  if (typeof jobId !== "string" || !jobId) {
    throw new Error("Thieu jobId");
  }

  const job = await read(
    process.env.JOBS_TABLE || "ddb-cloudtutor-jobs",
    jobId
  );

  if (!job) throw new Error("Khong tim thay job");

  if (job.test_fixture?.BOOL !== true) {
    throw new Error("Cong cu nay chi cho phep job test_fixture=true");
  }

  const result = await read(
    process.env.RESULTS_TABLE || "ddb-cloudtutor-results",
    jobId
  );

  const ownerId = job.owner_id?.S;
  const version = job.processing_version?.S;
  const source = result?.content_source?.S;
  const key = result?.transcript_key?.S;

  if (
    !ownerId || !version ||
    !["ASR", "OCR", "VISION"].includes(source) ||
    result?.processing_version?.S !== version ||
    !key?.startsWith(`results/${ownerId}/${jobId}/`)
  ) {
    throw new Error("Checkpoint Results khong hop le");
  }

  const state = source === "VISION"
    ? job.vision_handoff_state?.S
    : job.text_handoff_state?.S;

  if (state === "SENT") {
    return { action: "ALREADY_SENT", job_id: jobId };
  }

  if (job.status?.S !== "PROCESSING_AI" || state !== "PENDING") {
    throw new Error("Job khong o PROCESSING_AI/PENDING");
  }

  if (!apply) {
    return {
      action: "WOULD_DISPATCH",
      job_id: jobId,
      source,
      transcript_key: key,
    };
  }

  const expectedQueue = process.env.CT_EXPECTED_AI_TEST_QUEUE_URL;

  if (
    !expectedQueue ||
    process.env.AI_QUEUE_URL !== expectedQueue ||
    !new URL(expectedQueue).pathname
      .split("/").pop().startsWith("sqs-cloudtutor-vision-handoff-test-")
  ) {
    throw new Error("AI_QUEUE_URL khong phai queue handoff test");
  }

  const bucket = process.env.MEDIA_BUCKET;
  if (!bucket) throw new Error("Thieu MEDIA_BUCKET");

  const dispatch = source === "VISION"
    ? dispatchVisionHandoff
    : dispatchTextHandoff;

  await dispatch({
    jobId,
    ownerId,
    processingVersion: version,
    bucket,
    source,
  });

  return { action: "DISPATCHED", job_id: jobId, source };
}

module.exports = { recoverPendingHandoff };

if (require.main === module) {
  recoverPendingHandoff({
    jobId: process.argv[2],
    apply: process.argv.includes("--apply"),
  }).then(result => {
    console.log(JSON.stringify(result, null, 2));
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}