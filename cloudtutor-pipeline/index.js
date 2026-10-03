const { TranscribeClient, StartTranscriptionJobCommand } = require("@aws-sdk/client-transcribe");

const transcribeClient = new TranscribeClient({ region: "ap-southeast-1" });

exports.handler = async (event) => {
  for (const record of event.Records) {
    const body = JSON.parse(record.body);

    for (const s3Record of body.Records) {
      const bucket = s3Record.s3.bucket.name;
      const key = decodeURIComponent(s3Record.s3.object.key.replace(/\+/g, " "));

      console.log("Video moi:", bucket, key);

      // key dang: videos/{owner_id}/{job_id}/original.mp4
      const parts = key.split("/");
      const jobId = parts[2];

      const jobName = `cloudtutor-${jobId}`;
      const mediaUri = `s3://${bucket}/${key}`;

      try {
        await transcribeClient.send(new StartTranscriptionJobCommand({
          TranscriptionJobName: jobName,
          LanguageCode: "en-US",
          Media: { MediaFileUri: mediaUri },
          MediaFormat: "mp4",
        }));
        console.log(`Da bat dau Transcribe cho job ${jobName}`);
      } catch (err) {
        if (err.name === "ConflictException") {
          console.log(`Job ${jobName} da ton tai, bo qua (idempotency)`);
        } else {
          console.error("Loi khi goi Transcribe:", err);
          throw err;
        }
      }
    }
  }
  return { statusCode: 200 };
};