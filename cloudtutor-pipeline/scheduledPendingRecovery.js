const { randomUUID } = require("node:crypto");
const {
  DynamoDBClient, GetItemCommand, UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");
const { findStaleJobs } = require("./reconcileJobs");
const { recoverPendingHandoff } = require("./recoverPendingHandoff");

const db = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});
const table = process.env.JOBS_TABLE || "ddb-cloudtutor-jobs";

exports.handler = async (event = {}, context) => {
  const thresholdMinutes = Number(event.threshold_minutes ?? 30);

  // Báo cáo job thật vẫn chỉ đọc.
  const report = await findStaleJobs({
    thresholdMinutes,
    includeTestFixtures: false,
  });

  console.log(JSON.stringify({
    event: "RECONCILE_SUMMARY",
    stale_count: report.stale_count,
    missing_updated_at_count: report.missing_updated_at_count,
  }));

  for (const job of report.stale_jobs) {
    console.warn(JSON.stringify({ event: "STALE_JOB", ...job }));
  }

  for (const job of report.missing_updated_at) {
    console.warn(JSON.stringify({
      event: "JOB_MISSING_UPDATED_AT", ...job,
    }));
  }

  report.recovery = [];

  if (process.env.AUTO_RECOVER_TEST_PENDING !== "true") {
    return report;
  }

  // ID chỉ định phục vụ kiểm thử; vẫn phải vượt kiểm tra fixture.
  const candidates = event.recovery_test_job_id
    ? [{ job_id: event.recovery_test_job_id }]
    : (await findStaleJobs({
        thresholdMinutes,
        includeTestFixtures: true,
      })).stale_jobs.filter(job =>
        job.status === "PROCESSING_AI" &&
        (
          job.text_handoff_state === "PENDING" ||
          job.vision_handoff_state === "PENDING"
        )
      );

  let failures = 0;

  for (const candidate of candidates.slice(0, 3)) {
    if (context && context.getRemainingTimeInMillis() < 25000) break;

    const key = { job_id: { S: candidate.job_id } };
    const read = await db.send(new GetItemCommand({
      TableName: table,
      Key: key,
      ConsistentRead: true,
    }));

    const job = read.Item;

    // Không sửa hoặc gửi message cho job thật.
    if (
      job?.test_fixture?.BOOL !== true ||
      job.status?.S !== "PROCESSING_AI" ||
      !job.owner_id?.S ||
      !job.processing_version?.S
    ) {
      report.recovery.push({
        job_id: candidate.job_id,
        action: "SKIPPED_NOT_ELIGIBLE",
      });
      continue;
    }

    const field = job.vision_handoff_state?.S === "PENDING"
      ? "vision_handoff_state"
      : job.text_handoff_state?.S === "PENDING"
        ? "text_handoff_state"
        : null;

    if (!field) {
      report.recovery.push({
        job_id: candidate.job_id,
        action: "SKIPPED_NOT_PENDING",
      });
      continue;
    }

    const token = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    try {
      // Khóa giữa các lượt reconcile; không phải khóa mọi worker.
      await db.send(new UpdateItemCommand({
        TableName: table,
        Key: key,
        ConditionExpression:
          "#fixture = :yes AND #status = :ai " +
          "AND #owner = :owner AND #version = :version " +
          "AND #handoff = :pending " +
          "AND (attribute_not_exists(#lease) OR #lease < :now) " +
          "AND (attribute_not_exists(#next) OR #next <= :now) " +
          "AND (attribute_not_exists(#attempts) OR #attempts < :max)",
        UpdateExpression:
          "SET #lease = :expiry, #token = :token, #next = :next " +
          "ADD #attempts :one",
        ExpressionAttributeNames: {
          "#fixture": "test_fixture",
          "#status": "status",
          "#owner": "owner_id",
          "#version": "processing_version",
          "#handoff": field,
          "#lease": "pending_recovery_lease_until",
          "#token": "pending_recovery_token",
          "#next": "pending_recovery_next_at",
          "#attempts": "pending_recovery_attempts",
        },
        ExpressionAttributeValues: {
          ":yes": { BOOL: true },
          ":ai": { S: "PROCESSING_AI" },
          ":owner": { S: job.owner_id.S },
          ":version": { S: job.processing_version.S },
          ":pending": { S: "PENDING" },
          ":now": { N: String(now) },
          ":expiry": { N: String(now + 180) },
          ":next": { N: String(now + 900) },
          ":token": { S: token },
          ":max": { N: "3" },
          ":one": { N: "1" },
        },
      }));
    } catch (error) {
      if (error.name === "ConditionalCheckFailedException") {
        report.recovery.push({
          job_id: candidate.job_id,
          action: "SKIPPED_LOCKED_BACKOFF_OR_LIMIT",
        });
        continue;
      }
      throw error;
    }

    try {
      const result = await recoverPendingHandoff({
        jobId: candidate.job_id,
        apply: true,
      });

      report.recovery.push(result);
      console.log(JSON.stringify({
        event: "PENDING_RECOVERY", ...result,
      }));
    } catch (error) {
      failures++;
      console.error(JSON.stringify({
        event: "PENDING_RECOVERY_FAILED",
        job_id: candidate.job_id,
        error_name: error.name,
      }));
    } finally {
      try {
        await db.send(new UpdateItemCommand({
          TableName: table,
          Key: key,
          ConditionExpression: "#token = :token",
          UpdateExpression: "REMOVE #lease, #token",
          ExpressionAttributeNames: {
            "#lease": "pending_recovery_lease_until",
            "#token": "pending_recovery_token",
          },
          ExpressionAttributeValues: {
            ":token": { S: token },
          },
        }));
      } catch (error) {
        if (error.name !== "ConditionalCheckFailedException") throw error;
      }
    }
  }

  if (failures) {
    throw new Error(`Pending recovery failed for ${failures} test jobs`);
  }

  return report;
};