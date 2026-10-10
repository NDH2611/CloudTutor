const {
  TranscribeClient,
  GetTranscriptionJobCommand,
} = require("@aws-sdk/client-transcribe");

const transcribeClient = new TranscribeClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

async function fetchJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(`Khong doc duoc transcript: HTTP ${response.status}`);
  }

  return response.json();
}

exports.handler = async (event) => {
  const detail = event.detail;

  if (!detail?.TranscriptionJobName) {
    throw new Error("Su kien thieu TranscriptionJobName");
  }

  const jobName = detail.TranscriptionJobName;
  const status = detail.TranscriptionJobStatus;

  if (!jobName.startsWith("transcribe-cloudtutor-")) {
    console.log("Bo qua job ngoai CloudTutor:", jobName);
    return;
  }

  console.log("Nhan ket qua:", jobName, status);

  const result = await transcribeClient.send(
    new GetTranscriptionJobCommand({
      TranscriptionJobName: jobName,
    })
  );

  const job = result.TranscriptionJob;

  if (job.TranscriptionJobStatus === "FAILED") {
    console.error(
      "Transcribe that bai:",
      jobName,
      job.FailureReason
    );
    return;
  }

  if (job.TranscriptionJobStatus !== "COMPLETED") {
    throw new Error("Transcribe chua hoan tat");
  }

  const transcriptUri = job.Transcript?.TranscriptFileUri;

  if (!transcriptUri) {
    throw new Error("Khong co TranscriptFileUri");
  }

  const transcriptJson = await fetchJson(transcriptUri);
  const transcriptText =
    transcriptJson.results?.transcripts?.[0]?.transcript;

  if (typeof transcriptText !== "string") {
    throw new Error("Output transcript khong dung dinh dang");
  }

  console.log("Noi dung transcript:", transcriptText);

  if (!transcriptText.trim()) {
    console.log("Transcript rong — can OCR fallback o buoc sau");
  }

  return { statusCode: 200 };
};