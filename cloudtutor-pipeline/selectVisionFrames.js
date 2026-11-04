const {
  S3Client,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

/**
 * Tìm frame của một job và chọn tối đa maxFrames ảnh trải đều.
 *
 * Trả về:
 * [{ key, index }, ...]
 */
async function selectVisionFrames({
  bucket,
  ownerId,
  jobId,
  interval,
  duration,
  maxFrames = 3,
}) {
  if (!bucket || !ownerId || !jobId) {
    throw new Error("Thieu bucket, owner_id hoac job_id");
  }

  // Không cho ownerId hoặc jobId tạo thêm cấp thư mục.
  if (
    /[\/\\]/.test(ownerId) ||
    /[\/\\]/.test(jobId) ||
    ownerId === "." ||
    ownerId === ".." ||
    jobId === "." ||
    jobId === ".."
  ) {
    throw new Error("owner_id hoac job_id khong hop le");
  }

  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error("Khoang cach frame khong hop le");
  }

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Thoi luong video khong hop le");
  }

  if (!Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > 10) {
    throw new Error("maxFrames phai nam trong khoang 1 den 10");
  }

  const prefix = `frames/${ownerId}/${jobId}/`;
  const frames = [];
  let continuationToken;

  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const object of page.Contents || []) {
      const key = object.Key || "";

      // Ví dụ: source_frame.0000003.jpg
      const match = key.match(/_frame\.(\d{7})\.jpg$/i);

      if (!match) continue;

      const index = Number(match[1]);

      // Bỏ các frame có mốc nằm ngoài thời lượng video.
      if (index * interval >= duration) continue;

      frames.push({ key, index });
    }

    continuationToken = page.NextContinuationToken;
  } while (continuationToken);

  frames.sort((a, b) => a.index - b.index);

  if (frames.length === 0) {
    throw new Error("Khong tim thay frame hop le cho Vision");
  }

  if (frames.length <= maxFrames) {
    return frames;
  }

  // Nếu chỉ chọn một frame, lấy frame đầu tiên.
  if (maxFrames === 1) {
    return [frames[0]];
  }

  // Chọn các vị trí trải đều từ đầu đến cuối danh sách frame.
  const selected = [];

  for (let i = 0; i < maxFrames; i++) {
    const position = Math.round(
      (i * (frames.length - 1)) / (maxFrames - 1)
    );

    selected.push(frames[position]);
  }

  return selected;
}

module.exports = { selectVisionFrames };