const {
  SQSClient,
  SendMessageCommand,
} = require("@aws-sdk/client-sqs");

const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

async function publishTranscript({
  bucket,
  key,
  jobId,
  ownerId,
  source,
  processingVersion = "1",
}) {
  const queueUrl = process.env.AI_QUEUE_URL;

  if (!queueUrl) {
    throw new Error("Thieu AI_QUEUE_URL");
  }

  if (!bucket || !key || !jobId || !ownerId) {
    throw new Error("Thieu thong tin ban giao AI");
  }

  if (!["ASR", "OCR", "VISION"].includes(source)) {
    throw new Error(`Nguon noi dung khong hop le: ${source}`);
  }

  const message = {
    schema_version: "1.0",
    job_id: jobId,
    owner_id: ownerId,
    bucket,
    transcript_key: key,
    source,
    processing_version: String(processingVersion),
    handoff_id: `${ownerId}/${jobId}/v${processingVersion}`,
  };

  const result = await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
    })
  );

  console.log("Da gui cong viec AI:", {
    job_id: jobId,
    handoff_id: message.handoff_id,
    message_id: result.MessageId,
    transcript_key: key,
  });

  return result.MessageId;
}

module.exports = { publishTranscript };