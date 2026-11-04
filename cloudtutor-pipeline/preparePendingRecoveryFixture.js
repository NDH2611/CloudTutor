const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const {
  DynamoDBClient,
  TransactWriteItemsCommand,
  GetItemCommand,
} = require("@aws-sdk/client-dynamodb");
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

async function main() {
  const resources = JSON.parse(fs.readFileSync(
    "pipeline-integration-test-resources.json", "utf8"
  ));

  const queue = resources.ai_test_queue_url;

  if (
    typeof queue !== "string" ||
    !new URL(queue).pathname.split("/").pop()
      .startsWith("sqs-cloudtutor-vision-handoff-test-")
  ) {
    throw new Error("Queue test khong hop le");
  }

  process.env.AI_QUEUE_URL = queue;
  process.env.CT_EXPECTED_AI_TEST_QUEUE_URL = queue;
  process.env.MEDIA_BUCKET = "s3-cloudtutor-media-251929332061";

  // Nạp dispatcher sau khi thiết lập queue thử.
  const { recoverPendingHandoff } =
    require("./recoverPendingHandoff");

  const region = process.env.AWS_REGION || "ap-southeast-1";
  const db = new DynamoDBClient({ region });
  const s3 = new S3Client({ region });
  const bucket = process.env.MEDIA_BUCKET;
  const ownerId = "test-user";
  const jobId = `pending-recovery-test-${randomUUID()}`;
  const key = `results/${ownerId}/${jobId}/vision-cache-v1.json`;

  const sourceKey =
    "results/test-user/" +
    "vision-content-test-7cb7e5e0457e45dd946d3df2b843209b/" +
    "vision-cache-v1.json";

  const saved = await s3.send(new GetObjectCommand({
    Bucket: bucket,
    Key: sourceKey,
  }));

  const transcript = JSON.parse(
    await saved.Body.transformToString()
  );

  assert.equal(transcript.source, "VISION");
  assert.ok(transcript.text?.trim());
  assert.ok(transcript.segments?.length);

  Object.assign(transcript, {
    job_id: jobId,
    owner_id: ownerId,
    processing_version: "1",
    test: "PENDING_RECOVERY_TEST",
  });

  fs.writeFileSync("pending-recovery-fixture.json",
    JSON.stringify({ job_id: jobId, bucket, transcript_key: key }, null, 2)
  );

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: "application/json",
    Body: JSON.stringify(transcript),
    IfNoneMatch: "*",
  }));

  await db.send(new TransactWriteItemsCommand({
    TransactItems: [
      {
        Put: {
          TableName: "ddb-cloudtutor-jobs",
          ConditionExpression: "attribute_not_exists(job_id)",
          Item: {
            job_id: { S: jobId },
            owner_id: { S: ownerId },
            processing_version: { S: "1" },
            status: { S: "PROCESSING_AI" },
            vision_handoff_state: { S: "PENDING" },
            test_fixture: { BOOL: true },
            updated_at: { S: new Date().toISOString() },
          },
        },
      },
      {
        Put: {
          TableName: "ddb-cloudtutor-results",
          ConditionExpression: "attribute_not_exists(job_id)",
          Item: {
            job_id: { S: jobId },
            processing_version: { S: "1" },
            content_source: { S: "VISION" },
            transcript_key: { S: key },
          },
        },
      },
    ],
  }));

  console.log("DA TAO PENDING FIXTURE:", jobId); return;
  const preview = await recoverPendingHandoff({ jobId });
  assert.equal(preview.action, "WOULD_DISPATCH");
  console.log("PASS: dry-run khong gui message");

  const sent = await recoverPendingHandoff({ jobId, apply: true });
  assert.equal(sent.action, "DISPATCHED");

  const response = await db.send(new GetItemCommand({
    TableName: "ddb-cloudtutor-jobs",
    Key: { job_id: { S: jobId } },
    ConsistentRead: true,
  }));

  assert.equal(response.Item.vision_handoff_state.S, "SENT");
  console.log("PASS: PENDING -> gui queue test -> SENT");

  const repeated = await recoverPendingHandoff({ jobId, apply: true });
  assert.equal(repeated.action, "ALREADY_SENT");
  console.log("PASS: chay lai SENT -> bo qua");
  console.log("Job test:", jobId);
}

main().catch(error => {
  console.error("TEST THAT BAI:", error);
  process.exitCode = 1;
});