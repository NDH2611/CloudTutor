"use strict";
const { S3Client, HeadObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const s3 = new S3Client({ region: process.env.AWS_REGION || "ap-southeast-1" });
// MB theo hệ thập phân; phải thống nhất cùng giới hạn phía API/UI.
const MAX_VIDEO_BYTES = 500_000_000;
const HEADER_BYTES = 65536;
class VideoInputError extends Error {
  constructor(code) { super(code); this.name = "VideoInputError"; this.code = code; }
}
function inspectMp4Header(bytes) {
  const b = Buffer.from(bytes);
  let offset = 0;
  for (let boxes = 0; boxes < 64 && offset + 8 <= b.length; boxes++) {
    let size = b.readUInt32BE(offset);
    const type = b.toString("ascii", offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > b.length) break;
      const extended = b.readBigUInt64BE(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(extended); header = 16;
    }
    if (size < header || offset + size > b.length) break;
    if (type === "ftyp") {
      if (size < header + 8 || (size - header - 8) % 4 !== 0) break;
      const major = b.toString("ascii", offset + header, offset + header + 4);
      const brands = [major];
      for (let i = offset + header + 8; i < offset + size; i += 4) brands.push(b.toString("ascii", i, i + 4));
      if (/^(qt  |3g)/i.test(major)) break;
      if (brands.some(x => /^(isom|iso[2-9]|mp4[12]|avc1|M4V |dash|MSNV)$/.test(x))) return { major_brand: major };
      break;
    }
    // Chỉ cho phép các box đệm trước ftyp, không tìm chuỗi ftyp trong dữ liệu tùy ý.
    if (!["free", "skip", "wide"].includes(type)) break;
    offset += size;
  }
  throw new VideoInputError("VIDEO_INVALID_MP4_HEADER");
}
const cleanEtag = v => typeof v === "string" ? v.replace(/^"|"$/g, "").toLowerCase() : null;
async function validateVideoInput({ bucket, key, eventEtag, eventVersionId, client = s3 }) {
  if (!/\.mp4$/i.test(key)) throw new VideoInputError("VIDEO_EXTENSION_NOT_MP4");
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  // Event cũ không được phép đánh dấu lỗi cho object mới cùng key.
  if ((eventEtag && cleanEtag(eventEtag) !== cleanEtag(head.ETag)) ||
      (eventVersionId && eventVersionId !== "null" && head.VersionId !== eventVersionId)) {
    return { skipped: true, reason: "STALE_S3_OBJECT_EVENT" };
  }
  if (!Number.isSafeInteger(head.ContentLength) || head.ContentLength <= 0) throw new VideoInputError("VIDEO_EMPTY_OR_INVALID_SIZE");
  if (head.ContentLength > MAX_VIDEO_BYTES) throw new VideoInputError("VIDEO_TOO_LARGE");
  if (!head.ETag) throw new Error("S3_HEAD_MISSING_ETAG");
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key,
    Range: `bytes=0-${Math.min(HEADER_BYTES, head.ContentLength) - 1}`, IfMatch: head.ETag }));
  const bytes = response.Body?.transformToByteArray ? await response.Body.transformToByteArray() : response.Body;
  if (!bytes || bytes.length > HEADER_BYTES) throw new Error("S3_HEADER_READ_INVALID");
  const format = inspectMp4Header(bytes);
  return { skipped: false, content_length: head.ContentLength, etag: head.ETag,
    version_id: head.VersionId || null, content_type: head.ContentType || null,
    ...format, container_check: "FTYP_ONLY", checked_at: new Date().toISOString() };
}
module.exports = { validateVideoInput, inspectMp4Header, VideoInputError, MAX_VIDEO_BYTES };
