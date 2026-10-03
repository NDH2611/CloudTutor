const { TranscribeClient, GetTranscriptionJobCommand } = require("@aws-sdk/client-transcribe");
const https = require("https");

const transcribeClient = new TranscribeClient({ region: "ap-southeast-1" });

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

exports.handler = async (event) => {
  console.log("Nhan duoc su kien Transcribe:", JSON.stringify(event.detail));

  const jobName = event.detail.TranscriptionJobName;
  const status = event.detail.TranscriptionJobStatus;

  if (status !== "COMPLETED") {
    console.log(`Job ${jobName} ket thuc voi trang thai ${status}, khong xu ly tiep.`);
    return { statusCode: 200 };
  }

  const result = await transcribeClient.send(new GetTranscriptionJobCommand({
    TranscriptionJobName: jobName,
  }));

  const transcriptUri = result.TranscriptionJob.Transcript.TranscriptFileUri;
  console.log("Transcript URI:", transcriptUri);

  const transcriptJson = await fetchJson(transcriptUri);
  const transcriptText = transcriptJson.results.transcripts[0].transcript;

  console.log("Noi dung transcript:", transcriptText);

  return { statusCode: 200 };
};