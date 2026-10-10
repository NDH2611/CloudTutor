const {
  TranscribeClient,
  StartTranscriptionJobCommand,
} = require("@aws-sdk/client-transcribe");

const transcribeClient = new TranscribeClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

exports.handler = async (event) => {
  for (const record of event.Records || []) {
    const body = JSON.parse(record.body);

    // S3 gửi sự kiện kiểm tra khi bật notification.
    if (body.Event === "s3:TestEvent") {
      console.log("Bo qua su kien kiem tra S3");
      continue;
    }

    if (!Array.isArray(body.Records)) {
      throw new Error("Message khong dung dinh dang S3 notification");
    }

    for (const s3Record of body.Records) {
      const bucket = s3Record.s3.bucket.name;
      const key = decodeURIComponent(
        s3Record.s3.object.key.replace(/\+/g, " ")
      );

      if (bucket !== process.env.MEDIA_BUCKET) {
        throw new Error(`Bucket khong hop le: ${bucket}`);
      }

      // videos/{owner_id}/{job_id}/source.mp4
      // Vẫn chấp nhận tên file original.mp4 như code cũ.
      const parts = key.split("/");

      if (
        parts.length !== 4 ||
        parts[0] !== "videos" ||
        !parts[1] ||
        !parts[2] ||
        !/\.mp4$/i.test(parts[3])
      ) {
        throw new Error(`Video key khong hop le: ${key}`);
      }

      const jobId = parts[2];
      const jobName = `transcribe-cloudtutor-${jobId}`;

      if (
        jobName.length > 200 ||
        !/^[a-zA-Z0-9._-]+$/.test(jobName)
      ) {
        throw new Error(`Ten Transcribe job khong hop le: ${jobName}`);
      }

      console.log("Video moi:", bucket, key);

      try {
        await transcribeClient.send(
          new StartTranscriptionJobCommand({
            TranscriptionJobName: jobName,
            LanguageCode: process.env.TRANSCRIBE_LANGUAGE || "en-US",
            Media: {
              MediaFileUri: `s3://${bucket}/${key}`,
            },
            MediaFormat: "mp4",
          })
        );

        console.log(`Da bat dau Transcribe: ${jobName}`);
      } catch (err) {
        if (err.name === "ConflictException") {
          console.log(`Job da ton tai, bo qua: ${jobName}`);
        } else {
          console.error("Loi khi goi Transcribe:", err);
          throw err;
        }
      }
    }
  }

  return { statusCode: 200 };
};