const { randomUUID } = require("node:crypto");

const {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
} = require("@aws-sdk/client-dynamodb");

const { stageVisionResult } = require("./stageVisionResult");

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

async function getItem(tableName, jobId) {
  const response = await dynamodb.send(
    new GetItemCommand({
      TableName: tableName,
      Key: {
        job_id: { S: jobId },
      },
      ConsistentRead: true,
    })
  );

  return response.Item || null;
}

async function main() {
  const jobId = `vision-conflict-test-${randomUUID()}`;
  const ownerId = "test-user";
  const oldKey = `results/${ownerId}/${jobId}/existing-asr.json`;
  const visionKey = `results/${ownerId}/${jobId}/normalized-vision.json`;

  // Lưu ID trên màn hình để có thể tìm và dọn dữ liệu thử sau này.
  console.log("Job thu:", jobId);

  // Tạo job thử ở trạng thái đang xử lý Vision.
  await dynamodb.send(
    new PutItemCommand({
      TableName: "ddb-cloudtutor-jobs",
      Item: {
        job_id: { S: jobId },
        owner_id: { S: ownerId },
        status: { S: "PROCESSING_VISION" },
        processing_version: { S: "1" },
        test_fixture: { BOOL: true },
      },
      ConditionExpression: "attribute_not_exists(job_id)",
    })
  );

  // Giả lập Results đã tồn tại với nguồn ASR.
  await dynamodb.send(
    new PutItemCommand({
      TableName: "ddb-cloudtutor-results",
      Item: {
        job_id: { S: jobId },
        transcript_key: { S: oldKey },
        content_source: { S: "ASR" },
        processing_version: { S: "1" },
        test_fixture: { BOOL: true },
      },
      ConditionExpression: "attribute_not_exists(job_id)",
    })
  );

  try {
    await stageVisionResult({
      jobId,
      ownerId,
      processingVersion: "1",
      transcriptKey: visionKey,
    });

    throw new Error("LOI: Vision da duoc phep ghi de Results ASR");
  } catch (err) {
    if (err.name !== "TransactionCanceledException") {
      throw err;
    }

    // Thao tác thứ 2 trong transaction là cập nhật Results.
    const reason = err.CancellationReasons?.[1]?.Code;

    if (reason !== "ConditionalCheckFailed") {
      throw new Error(
        `Transaction bi huy vi ly do khac: ${reason || "UNKNOWN"}`
      );
    }

    console.log("Results tu choi ghi de:", reason);
  }

  const job = await getItem("ddb-cloudtutor-jobs", jobId);
  const result = await getItem("ddb-cloudtutor-results", jobId);

  if (job?.status?.S !== "PROCESSING_VISION") {
    throw new Error("LOI: Trang thai job da thay doi");
  }

  if (
    result?.content_source?.S !== "ASR" ||
    result?.transcript_key?.S !== oldKey
  ) {
    throw new Error("LOI: Results ASR da bi thay doi");
  }

  console.log("Trang thai job:", job.status.S);
  console.log("Nguon Results:", result.content_source.S);
  console.log("Transcript key cu duoc giu nguyen.");
  console.log("KIEM THU DAT");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});