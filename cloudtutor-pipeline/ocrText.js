"use strict";
// Chỉ chuẩn hóa Unicode/khoảng trắng, không bỏ dấu tiếng Việt.
function comparisonKey(text) { return text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase(); }
function buildFrameText(lines) {
  const seen = new Set(), texts = [];
  for (const line of lines) {
    const text = (line.DetectedText || "").normalize("NFC").replace(/\s+/g, " ").trim();
    const key = comparisonKey(text);
    if (key && !seen.has(key)) { seen.add(key); texts.push(text); }
  }
  return texts.join("\n");
}
function selectOcrLines(detections) {
  return (detections || []).filter(x => x.Type === "LINE" && x.Confidence >= 80)
    .sort((a, b) => a.Geometry.BoundingBox.Top - b.Geometry.BoundingBox.Top || a.Geometry.BoundingBox.Left - b.Geometry.BoundingBox.Left);
}
module.exports = { comparisonKey, buildFrameText, selectOcrLines };
