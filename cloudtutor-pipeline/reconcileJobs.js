const {
  DynamoDBClient,
  ScanCommand,
} = require("@aws-sdk/client-dynamodb");

const region = process.env.AWS_REGION || "ap-southeast-1";
const tableName = process.env.JOBS_TABLE || "ddb-cloudtutor-jobs";

const dynamodb = new DynamoDBClient({ region });

const PROCESSING_STATES = new Set([
  "PROCESSING_ASR",
  "PROCESSING_OCR",
  "PROCESSING_VISION",
  "PROCESSING_AI",
]);

function getAgeMinutes(updatedAt, nowMs) {
  const updatedMs = Date.parse(updatedAt);

  if (!Number.isFinite(updatedMs)) {
    return null;
  }

  return Math.floor((nowMs - updatedMs) / 60000);
}

/**
 * Phiên bản kiểm tra: chỉ đọc và báo các job quá hạn.
 * Không thay đổi DynamoDB, không tạo lại AWS job, không gửi SQS.
 */
async function findStaleJobs({
  thresholdMinutes = 30,
  includeTestFixtures = false,
} = {}) {
  if (!Number.isFinite(thresholdMinutes) || thresholdMinutes <= 0) {
    throw new Error("thresholdMinutes phai lon hon 0");
  }

  const nowMs = Date.now();
  const staleJobs = [];
  const missingUpdatedAt = [];
  let lastKey;
  let scannedCount = 0;

  do {
    const response = await dynamodb.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastKey,

        ProjectionExpression:
          "job_id, #owner, #status, updated_at, " +
          "processing_version, transcription_job_name, " +
          "ocr_mediaconvert_job_id, vision_mediaconvert_job_id, " +
          "text_handoff_state, vision_handoff_state, test_fixture",

        ExpressionAttributeNames: {
          "#owner": "owner_id",
          "#status": "status",
        },
      })
    );

    scannedCount += response.ScannedCount || 0;

    for (const item of response.Items || []) {
      const status = item.status?.S;

      if (!PROCESSING_STATES.has(status)) {
        continue;
      }

      if (!includeTestFixtures && item.test_fixture?.BOOL === true) {
        continue;
      }

      const ageMinutes = getAgeMinutes(item.updated_at?.S, nowMs);

      const job = {
        job_id: item.job_id?.S || null,
        owner_id: item.owner_id?.S || null,
        status,
        processing_version: item.processing_version?.S || null,
        updated_at: item.updated_at?.S || null,
        age_minutes: ageMinutes,
        transcription_job_name: item.transcription_job_name?.S || null,
        ocr_mediaconvert_job_id:
          item.ocr_mediaconvert_job_id?.S || null,
        vision_mediaconvert_job_id:
          item.vision_mediaconvert_job_id?.S || null,
        text_handoff_state: item.text_handoff_state?.S || null,
        vision_handoff_state: item.vision_handoff_state?.S || null,
      };

      if (ageMinutes === null) {
        missingUpdatedAt.push(job);
      } else if (ageMinutes >= thresholdMinutes) {
        staleJobs.push(job);
      }
    }

    lastKey = response.LastEvaluatedKey;
  } while (lastKey);

  return {
    mode: "READ_ONLY",
    checked_at: new Date(nowMs).toISOString(),
    threshold_minutes: thresholdMinutes,
    include_test_fixtures: includeTestFixtures,
    scanned_count: scannedCount,
    stale_count: staleJobs.length,
    missing_updated_at_count: missingUpdatedAt.length,
    stale_jobs: staleJobs,
    missing_updated_at: missingUpdatedAt,
  };
}

exports.handler = async (event = {}) => {
  const thresholdMinutes =
    event.threshold_minutes === undefined
      ? 30
      : Number(event.threshold_minutes);

  return findStaleJobs({
    thresholdMinutes,
    includeTestFixtures: event.include_test_fixtures === true,
  });
};

if (require.main === module) {
  const thresholdMinutes = Number(process.argv[2] || "30");
  const includeTestFixtures = process.argv.includes("--include-test");

  findStaleJobs({
    thresholdMinutes,
    includeTestFixtures,
  })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error("Khong kiem tra duoc job:", error.message);
      process.exitCode = 1;
    });
}

module.exports.findStaleJobs = findStaleJobs;