const { publishTranscript } = require("./publishTranscript");

// Queue thử riêng, không có consumer của Member 3.
const TEST_QUEUE_URL =
  "https://sqs.ap-southeast-1.amazonaws.com/" +
  "251929332061/sqs-cloudtutor-vision-handoff-test-fb713c6d";

exports.handler = async (event) => {
  const jobId = event?.job_id;
  const ownerId = event?.owner_id;
  const processingVersion = event?.processing_version;

  if (!jobId || !ownerId || !processingVersion) {
    throw new Error("Thieu thong tin job thu");
  }

  const bucket = process.env.MEDIA_BUCKET;

  if (!bucket) {
    throw new Error("Thieu MEDIA_BUCKET");
  }

  // Chỉ handler thử này dùng queue thử.
  process.env.AI_QUEUE_URL = TEST_QUEUE_URL;

  const key = `results/${ownerId}/${jobId}/vision-save-test.json`;

  const messageId = await publishTranscript({
    bucket,
    key,
    jobId,
    ownerId,
    source: "VISION",
    processingVersion,
  });

  return {
    test: "VISION_HANDOFF_TEST",
    queue: "vision-handoff-test",
    job_id: jobId,
    message_id: messageId,
    transcript_key: key,
  };
};