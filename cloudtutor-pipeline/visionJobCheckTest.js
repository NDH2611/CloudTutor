const { checkVisionJob } = require("./visionJobCheck");

exports.handler = async (event) => {
  const result = await checkVisionJob({
    jobId: event?.job_id,
    ownerId: event?.owner_id,
    processingVersion: event?.processing_version,
  });

  return {
    test: "VISION_JOB_CHECK",
    job_id: event?.job_id,
    result,
  };
};