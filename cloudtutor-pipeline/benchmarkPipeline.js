const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const {
  DynamoDBClient, PutItemCommand, GetItemCommand,
} = require("@aws-sdk/client-dynamodb");

const {
  S3Client, CopyObjectCommand,
} = require("@aws-sdk/client-s3");

const execute = promisify(execFile);
const region = "ap-southeast-1";
const bucket = "s3-cloudtutor-media-251929332061";
const ownerId = "test-user";

process.env.AWS_PROFILE = "new";
process.env.AWS_REGION = region;

const db = new DynamoDBClient({ region });
const s3 = new S3Client({ region });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function aws(args) {
  const { stdout } = await execute("aws", [
    ...args,
    "--region", region,
    "--profile", "new",
    "--output", "json",
    "--no-cli-pager",
  ], {
    timeout: 90000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });

  return stdout.trim() ? JSON.parse(stdout) : {};
}

function save(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

async function read(table, jobId) {
  const result = await db.send(new GetItemCommand({
    TableName: table,
    Key: { job_id: { S: jobId } },
    ConsistentRead: true,
  }));
  return result.Item;
}

// Giới hạn số tiến trình AWS CLI chạy đồng thời trên máy.
async function pool(items, concurrency, action) {
  let cursor = 0;
  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        await action(item);
      }
    }
  ));
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(p * sorted.length) - 1];
}

async function main() {
  const integration = JSON.parse(fs.readFileSync(
    "pipeline-integration-test-resources.json", "utf8"
  ));

  const fixture = JSON.parse(fs.readFileSync(
    "e2e-current-run.json", "utf8"
  ));

  const source = fixture.cases.find(item => item.name === "speech");

  if (!source) throw new Error("Khong co speech fixture");

  for (const name of [
    integration.worker_function,
    integration.completion_function,
  ]) {
    if (!name?.startsWith("lambda-cloudtutor-test-")) {
      throw new Error("Chi cho phep Lambda test");
    }
  }

  const account = await aws(["sts", "get-caller-identity"]);
  if (account.Account !== "251929332061") {
    throw new Error("Sai AWS account");
  }

  const completion = await aws([
    "lambda", "get-function-configuration",
    "--function-name", integration.completion_function,
  ]);

  if (completion.Environment?.Variables?.AI_QUEUE_URL !==
      integration.ai_test_queue_url) {
    throw new Error("Completion khong tro AI queue test");
  }

  const routing = await aws([
    "events", "list-targets-by-rule",
    "--rule", "event-cloudtutor-e2e-transcription",
  ]);

  if (!routing.Targets?.some(target =>
    target.Arn.endsWith(`:function:${integration.completion_function}`)
  )) {
    throw new Error("Rule E2E khong tro dung Completion");
  }

  const sourceJob = await read("ddb-cloudtutor-jobs", source.job_id);
  const sourceResult = await read("ddb-cloudtutor-results", source.job_id);
  const sourceKey = sourceJob?.video_key?.S;

  if (
    !sourceKey?.startsWith("e2e-videos/test-user/") ||
    sourceJob.test_fixture?.BOOL !== true ||
    sourceResult?.content_source?.S !== "ASR"
  ) {
    throw new Error("Video mau chua duoc xac nhan ASR");
  }

  // Lấy thời lượng video để ghi khối lượng xử lý, không tự đoán giá.
  const probe = await execute("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    source.file,
  ], { windowsHide: true });

  const duration = Number(probe.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Khong doc duoc thoi luong video");
  }

  const runId = `benchmark-${new Date().toISOString()
    .replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;

  const directory = path.resolve("reports", "benchmarks", runId);
  const work = path.resolve("local-benchmark-work", runId);
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(work, { recursive: true });

  const report = {
    run_id: runId,
    started_at: new Date().toISOString(),
    scope: "WORKER_TO_ASR_AI_HANDOFF",
    trigger: "DIRECT_SYNCHRONOUS_WORKER_INVOCATION",
    region,
    source_video_seconds: duration,
    dataset: "Copies of one synthetic English speech video",
    batch_sizes: [1, 5, 10, 20],
    dispatch_concurrency: 4,
    timeout_per_batch_seconds: 600,
    cost_usd: null,
    cost_note: "Not calculated; requires verified service pricing",
    batches: [],
  };

  const reportPath = path.join(directory, "benchmark.json");
  save(reportPath, report);

  console.log("Run:", runId);
  console.log("Video duration:", duration.toFixed(2), "seconds");
  console.log("Report:", reportPath);

  for (const count of report.batch_sizes) {
    console.log(`\n========== BATCH ${count} ==========`);

    const batch = {
      size: count,
      setup_started_at: new Date().toISOString(),
      jobs: Array.from({ length: count }, (_, index) => ({
        job_id: `bench-${count}-${index + 1}-${randomUUID()}`,
        outcome: "PREPARING",
      })),
    };

    report.batches.push(batch);
    save(reportPath, report);

    // Chuẩn bị trước, không tính upload/copy vào latency Worker.
    await pool(batch.jobs, 4, async item => {
      const key = `e2e-videos/${ownerId}/${item.job_id}/source.mp4`;
      item.video_key = key;

      await db.send(new PutItemCommand({
        TableName: "ddb-cloudtutor-jobs",
        ConditionExpression: "attribute_not_exists(job_id)",
        Item: {
          job_id: { S: item.job_id },
          owner_id: { S: ownerId },
          video_key: { S: key },
          status: { S: "UPLOADED" },
          test_fixture: { BOOL: true },
          updated_at: { S: new Date().toISOString() },
        },
      }));

      await s3.send(new CopyObjectCommand({
        Bucket: bucket,
        Key: key,
        CopySource: bucket + "/" + sourceKey.split("/")
          .map(encodeURIComponent).join("/"),
      }));

      item.outcome = "READY";
    });

    save(reportPath, report);

    const batchStart = Date.now();
    batch.started_at = new Date(batchStart).toISOString();

    await pool(batch.jobs, 4, async item => {
      const eventPath = path.join(work, `${item.job_id}-event.json`);
      const responsePath = path.join(work, `${item.job_id}-response.json`);

      save(eventPath, {
        Records: [{
          messageId: item.job_id,
          eventSource: "aws:sqs",
          body: JSON.stringify({
            Records: [{
              eventSource: "aws:s3",
              eventName: "ObjectCreated:Put",
              s3: {
                bucket: { name: bucket },
                object: { key: item.video_key },
              },
            }],
          }),
        }],
      });

      item.invoked_at = new Date().toISOString();
      item.outcome = "WAITING";

      try {
        const invoked = await aws([
          "lambda", "invoke",
          "--function-name", integration.worker_function,
          "--cli-binary-format", "raw-in-base64-out",
          "--payload", `file://${eventPath}`,
          responsePath,
        ]);

        if (invoked.FunctionError) {
          item.worker_function_error = invoked.FunctionError;
        }
      } catch (error) {
        // Kết quả invoke có thể không rõ; vẫn theo dõi Jobs,
        // không tự gọi Worker lại để tránh tạo tải ngoài dự kiến.
        item.invoke_error = error.code || error.name;
      }
    });

    save(reportPath, report);

    const deadline = batchStart + 600000;

    while (Date.now() < deadline) {
      const waiting = batch.jobs.filter(item => item.outcome === "WAITING");
      if (!waiting.length) break;

      await pool(waiting, 4, async item => {
        const job = await read("ddb-cloudtutor-jobs", item.job_id);
        item.last_status = job?.status?.S || "MISSING";
        item.processing_version = job?.processing_version?.S;

        if (job?.status?.S === "FAILED") {
          item.outcome = "FAILED";
          item.error_code = job.error_code?.S || "UNKNOWN";
          return;
        }

        if (
          job?.status?.S === "PROCESSING_AI" &&
          job.text_handoff_state?.S === "SENT"
        ) {
          const result = await read(
            "ddb-cloudtutor-results", item.job_id
          );

          if (
            result?.content_source?.S !== "ASR" ||
            result.processing_version?.S !== item.processing_version
          ) {
            item.outcome = "CHECKPOINT_MISMATCH";
            return;
          }

          const completedMs = Date.parse(job.updated_at?.S);
          const latency = (completedMs - Date.parse(item.invoked_at)) / 1000;

          if (!Number.isFinite(latency) || latency < 0) {
            item.outcome = "INVALID_TIMESTAMP";
            return;
          }

          item.outcome = "SUCCESS";
          item.handoff_at = job.updated_at.S;
          item.latency_seconds = Number(latency.toFixed(3));
          item.transcript_key = result.transcript_key.S;
        }
      });

      save(reportPath, report);

      const successful = batch.jobs.filter(
        item => item.outcome === "SUCCESS"
      ).length;
      const pending = batch.jobs.filter(
        item => item.outcome === "WAITING"
      ).length;

      console.log(
        `Batch ${count}: success=${successful}/${count}; waiting=${pending}`
      );

      if (!pending) break;
      await sleep(10000);
    }

    for (const item of batch.jobs) {
      if (item.outcome === "WAITING") item.outcome = "TIMEOUT";
    }

    const successes = batch.jobs.filter(item => item.outcome === "SUCCESS");
    const latencies = successes.map(item => item.latency_seconds);

    batch.finished_at = new Date().toISOString();
    batch.success = successes.length;
    batch.failed = batch.jobs.filter(
      item => !["SUCCESS", "TIMEOUT"].includes(item.outcome)
    ).length;
    batch.timeout = batch.jobs.filter(
      item => item.outcome === "TIMEOUT"
    ).length;

    batch.mean_seconds = latencies.length
      ? Number((latencies.reduce((a, b) => a + b, 0) /
          latencies.length).toFixed(3))
      : null;
    batch.p95_seconds = percentile(latencies, 0.95);
    batch.max_seconds = latencies.length ? Math.max(...latencies) : null;
    batch.wall_seconds = Number(((Date.now() - batchStart) / 1000).toFixed(3));
    batch.submitted_video_minutes = Number(
      (count * duration / 60).toFixed(3)
    );

    save(reportPath, report);

    console.log(JSON.stringify({
      size: count,
      success: batch.success,
      failed: batch.failed,
      timeout: batch.timeout,
      mean_seconds: batch.mean_seconds,
      p95_seconds: batch.p95_seconds,
      wall_seconds: batch.wall_seconds,
    }, null, 2));

    // Dừng tăng tải nếu có lỗi; giữ toàn bộ bằng chứng đã thu.
    if (batch.success !== count) {
      console.log("STOP: Batch chua PASS het; khong tang tai tiep.");
      break;
    }
  }

  report.finished_at = new Date().toISOString();
  save(reportPath, report);

  const columns = [
    "size", "success", "failed", "timeout",
    "mean_seconds", "p95_seconds", "max_seconds",
    "wall_seconds", "submitted_video_minutes",
  ];

  fs.writeFileSync(
    path.join(directory, "summary.csv"),
    [
      columns.join(","),
      ...report.batches.map(batch =>
        columns.map(key => batch[key] ?? "").join(",")
      ),
    ].join("\n") + "\n",
    "utf8"
  );

  save("benchmark-latest.json", {
    run_id: runId,
    report_path: reportPath,
    directory,
  });

  console.log("\n========== SUMMARY ==========");
  console.table(report.batches.map(batch => ({
    videos: batch.size,
    success: batch.success,
    failed: batch.failed,
    timeout: batch.timeout,
    mean_s: batch.mean_seconds,
    p95_s: batch.p95_seconds,
    wall_s: batch.wall_seconds,
  })));

  console.log("Saved:", directory);

  if (
    report.batches.length !== 4 ||
    report.batches.some(batch => batch.success !== batch.size)
  ) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  // Không in env, credentials hoặc toàn bộ AWS request.
  console.error("BENCHMARK STOP:", error.name, error.message);
  process.exitCode = 1;
});