"use strict";
const { comparisonKey, buildFrameText, selectOcrLines } = require("./ocrText");
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1)));
    row = next;
  }
  return row[b.length];
}
function score(reference, hypothesis) {
  const r = comparisonKey(reference), h = comparisonKey(hypothesis);
  const rc = Array.from(r), hc = Array.from(h), rw = r ? r.split(" ") : [], hw = h ? h.split(" ") : [];
  const ce = distance(rc, hc), we = distance(rw, hw);
  return { character_edits: ce, reference_characters: rc.length, cer: rc.length ? ce / rc.length : null,
    word_edits: we, reference_words: rw.length, wer: rw.length ? we / rw.length : null,
    exact_match: r === h, blank_false_positive: !r && !!h };
}
module.exports = { distance, score };
if (require.main === module) (async () => {
  const fs = require("node:fs"), path = require("node:path");
  const { RekognitionClient, DetectTextCommand } = require("@aws-sdk/client-rekognition");
  const folder = process.argv[2];
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8").replace(/^\uFEFF/, ""));
  const client = new RekognitionClient({ region: "ap-southeast-1", maxAttempts: 2 });
  const rows = [];
  function report() {
    const summary = [];
    for (const language of ["en", "vi"]) {
      const items = rows.filter(r => r.language === language);
      const chars = items.reduce((s, r) => s + r.reference_characters, 0);
      const words = items.reduce((s, r) => s + r.reference_words, 0);
      summary.push({ language, samples: items.length,
        cer: chars ? items.reduce((s, r) => s + r.character_edits, 0) / chars : null,
        wer: words ? items.reduce((s, r) => s + r.word_edits, 0) / words : null,
        exact_matches: items.filter(r => r.exact_match).length });
    }
    return { scope: "SYNTHETIC_FRAME_PROBE_NOT_VIDEO_BENCHMARK", confidence: 80,
      normalization: "NFC, lowercase, collapse whitespace; accents retained", summary, rows };
  }
  for (const item of manifest) {
    const rawFile = path.join(folder, `${item.id}-raw.json`);
    // Tiếp tục từ phản hồi đã lưu, không tự gọi lại toàn bộ bài đo khi bị gián đoạn.
    const response = fs.existsSync(rawFile) ? JSON.parse(fs.readFileSync(rawFile, "utf8")) :
      await client.send(new DetectTextCommand({ Image: { Bytes: fs.readFileSync(path.join(folder, item.image)) } }));
    if (!fs.existsSync(rawFile)) fs.writeFileSync(rawFile, JSON.stringify(response, null, 2));
    const text = buildFrameText(selectOcrLines(response.TextDetections));
    const allLines = buildFrameText((response.TextDetections || []).filter(x => x.Type === "LINE")
      .sort((a, b) => a.Geometry.BoundingBox.Top - b.Geometry.BoundingBox.Top || a.Geometry.BoundingBox.Left - b.Geometry.BoundingBox.Left));
    const row = { ...item, hypothesis: text, ...score(item.reference, text),
      unfiltered_hypothesis: allLines, unfiltered_score: score(item.reference, allLines) };
    rows.push(row); console.log(JSON.stringify({ id: item.id, cer: row.cer, wer: row.wer, exact_match: row.exact_match }));
    fs.writeFileSync(path.join(folder, "evaluation.json"), JSON.stringify(report(), null, 2));
  }
  console.table(report().summary);
  console.log("SAVED OCR EVALUATION: " + path.join(folder, "evaluation.json"));
})().catch(e => { console.error("OCR evaluation stopped:", e.name, e.message); process.exitCode = 1; });
