const {
  MediaConvertClient,
  CreateJobCommand,
} = require("@aws-sdk/client-mediaconvert");

const { createHash } = require("node:crypto");

const template = require("./mediaconvert-job-template.json");

const mediaConvert = new MediaConvertClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

async function startOcrFallback({ bucket, videoKey, ownerId, jobId }) {
  const roleArn = process.env.MEDIACONVERT_ROLE_ARN;

  if (!roleArn) {
    throw new Error("Thieu MEDIACONVERT_ROLE_ARN");
  }

  if (!bucket || bucket !== process.env.MEDIA_BUCKET) {
    throw new Error("Bucket OCR khong hop le");
  }

  if (
    !ownerId ||
    !jobId ||
    /[/\\]/.test(ownerId) ||
    /[/\\]/.test(jobId)
  ) {
    throw new Error("owner_id hoac job_id khong hop le");
  }

  const expectedPrefix = `videos/${ownerId}/${jobId}/`;

  if (
    typeof videoKey !== "string" ||
    !videoKey.startsWith(expectedPrefix) ||
    videoKey.split("/").length !== 4
  ) {
    throw new Error("Video key OCR khong hop le");
  }

  // Sao chép cấu hình, không sửa file template gốc.
  const settings = structuredClone(template.Settings);

  if (!settings?.Inputs?.[0]) {
    throw new Error("Template thieu Inputs");
  }

  settings.Inputs[0].FileInput = `s3://${bucket}/${videoKey}`;

  const frameGroup = settings.OutputGroups?.find(
    group => group.Name === "CloudTutorFrames"
  );

  const derivedGroup = settings.OutputGroups?.find(
    group => group.Name === "CloudTutorDerived"
  );

  if (!frameGroup || !derivedGroup) {
    throw new Error("Template thieu nhom frame hoac video phu");
  }

  frameGroup.OutputGroupSettings.FileGroupSettings.Destination =
    `s3://${bucket}/frames/${ownerId}/${jobId}/`;

  derivedGroup.OutputGroupSettings.FileGroupSettings.Destination =
    `s3://${bucket}/derived/${ownerId}/${jobId}/`;

  const capture = frameGroup.Outputs[0]
    .VideoDescription.CodecSettings.FrameCaptureSettings;

  const interval =
    capture.FramerateDenominator / capture.FramerateNumerator;

  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error("Khoang cach frame khong hop le");
  }

  const token = createHash("sha256")
    .update(`cloudtutor-ocr-v1:${bucket}/${videoKey}`)
    .digest("hex");

  const response = await mediaConvert.send(
    new CreateJobCommand({
      Role: roleArn,
      JobTemplate: template.Name,
      ClientRequestToken: token,
      Settings: settings,
      UserMetadata: {
        project: "cloudtutor",
        stage: "extract-frames",
        owner_id: ownerId,
        job_id: jobId,
        frame_interval_seconds: String(interval),
      },
    })
  );

  const mediaConvertJobId = response.Job?.Id;

  if (!mediaConvertJobId) {
    throw new Error("MediaConvert khong tra ve job ID");
  }

  console.log("Da khoi dong OCR fallback:", {
    job_id: jobId,
    mediaconvert_job_id: mediaConvertJobId,
    frame_interval_seconds: interval,
  });

  return mediaConvertJobId;
}

module.exports = { startOcrFallback };