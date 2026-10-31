const fs = require("node:fs");

const {
  DynamoDBClient,
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
  const testItem = JSON.parse(
    fs.readFileSync("vision-deleted-job-item.json", "utf8")
  );

  const jobId = testItem.job_id?.S;
  const ownerId = "test-user";

  if (!jobId || !jobId.startsWith("vision-deleted-test-")) {
    throw new Error("Khong tim thay job DELETED thu nghiem");
  }

  const jobBefore = await getItem("ddb-cloudtutor-jobs", jobId);
  const resultBefore = await getItem("ddb-cloudtutor-results", jobId);

  if (jobBefore?.status?.S !== "DELETED") {
    throw new Error("Job thu khong o trang thai DELETED");
  }

  let transactionRejected = false;

  try {
    await stageVisionResult({
      jobId,
      ownerId,
      processingVersion: "1",
      transcriptKey:
        `results/${ownerId}/${jobId}/vision-save-test.json`,
    });
  } catch (err) {
    if (err.name !== "TransactionCanceledException") {
      throw err;
    }

    // Kiểm tra điều kiện ở thao tác cập nhật Jobs.
    const reason = err.CancellationReasons?.[0]?.Code;

    if (reason !== "ConditionalCheckFailed") {
      throw new Error(
        `Transaction bi huy vi ly do khac: ${reason || "UNKNOWN"}`
      );
    }

    transactionRejected = true;
    console.log("Transaction bi tu choi dung nhu mong doi:", reason);
  }

  if (!transactionRejected) {
    throw new Error("LOI: Transaction da chap nhan job DELETED");
  }

  const jobAfter = await getItem("ddb-cloudtutor-jobs", jobId);
  const resultAfter = await getItem("ddb-cloudtutor-results", jobId);

  if (jobAfter?.status?.S !== "DELETED") {
    throw new Error("LOI: Trang thai job da thay doi");
  }

  // Với job thử này, kiểm tra Results không tồn tại cả trước lẫn sau.
  if (resultBefore !== null || resultAfter !== null) {
    throw new Error(
      "Khong the ket luan: job thu da co item Results"
    );
  }

  console.log("Trang thai job sau thu:", jobAfter.status.S);
  console.log("Khong co item Results duoc tao.");
  console.log("KIEM THU DAT");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});