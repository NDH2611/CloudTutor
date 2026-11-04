"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const root = process.argv[2], reviewed = require("./reviewed-sources.json");
const normal = s => s.replace(/\r\n/g, "\n").trim() + "\n";
const edits = {};
for (const name of ["index.js", "onFramesReady.js"]) {
  let source = normal(fs.readFileSync(path.join(root, name), "utf8"));
  if (source.includes("M2_INPUT_OCR_V1")) { console.log("ALREADY PATCHED: " + name); continue; }
  if (crypto.createHash("sha256").update(source).digest("hex") !== reviewed[name]) throw new Error("SOURCE_CHANGED_REVIEW_REQUIRED: " + name);
  if (name === "index.js") {
    source = '// M2_INPUT_OCR_V1\nconst { guardInitialVideo } = require("./workerInputGuard");\n' + source;
    source = source.replace('  videoKey,\n}) {', '  videoKey,\n  bucket, eventEtag, eventVersionId,\n}) {');
    source = source.replace('if (status === "DELETING" || status === "DELETED")', 'if (status === "DELETING" || status === "DELETED" || (job.deleted_at?.S && job.deleted_at.S.trim()))');
    const anchor = '  const processingVersion = randomUUID();';
    source = source.replace(anchor, `  const validation = await guardInitialVideo({ dynamodb, jobsTable, jobId, ownerId, videoKey, bucket, eventEtag, eventVersionId });
  if (validation.skipped) return validation;
${anchor}`);
    source = source.replace('"AND attribute_not_exists(#version)",', '"AND attribute_not_exists(#version) " +\n        "AND (attribute_not_exists(#deleted) OR #deleted = :empty OR attribute_type(#deleted, :nullType))",');
    source = source.replace('"#transcribeName = :transcribeName, #updated = :now",', '"#transcribeName = :transcribeName, #updated = :now, #input = :input",');
    source = source.replace('        "#updated": "updated_at",', '        "#updated": "updated_at",\n        "#input": "input_validation",\n        "#deleted": "deleted_at",');
    source = source.replace('        ":now": { S: new Date().toISOString() },', '        ":now": { S: new Date().toISOString() },\n        ":input": { S: JSON.stringify(validation) },\n        ":empty": { S: "" },\n        ":nullType": { S: "NULL" },');
    source = source.replace('folder !== "videos"', 'folder !== (process.env.INPUT_VIDEO_PREFIX || "videos")');
    source = source.replace('!/\\.mp4$/i.test(filename)', '!filename || !/^[a-zA-Z0-9_-]+$/.test(ownerId) || !/^[a-zA-Z0-9_-]+$/.test(jobId)');
    source = source.replace('        videoKey: key,', '        videoKey: key,\n        bucket,\n        eventEtag: s3Record.s3?.object?.eTag,\n        eventVersionId: s3Record.s3?.object?.versionId,');
  } else {
    const start = source.indexOf('// Chuẩn hóa để so sánh'), end = source.indexOf('const region =');
    if (start < 0 || end < start) throw new Error("OCR_ANCHOR_MISSING");
    source = '// M2_INPUT_OCR_V1\n' + source.slice(0, start) + 'const { comparisonKey, buildFrameText, selectOcrLines } = require("./ocrText");\n\n' + source.slice(end);
    const lineStart = source.indexOf('    const lines = (response.TextDetections || [])');
    const lineEnd = source.indexOf('\n    const text = buildFrameText(lines);', lineStart);
    if (lineStart < 0 || lineEnd < 0) throw new Error("OCR_LINES_ANCHOR_MISSING");
    source = source.slice(0, lineStart) + '    const lines = selectOcrLines(response.TextDetections);\n' + source.slice(lineEnd);
    source = source.replace('  "OCR_TEXT_REQUIRES_REVIEW",', '  "OCR_TEXT_REQUIRES_REVIEW",\n  "OCR_LANGUAGE_SUPPORT_LIMITED",');
  }
  edits[name] = source;
}
for (const name of ["validateVideoInput.js", "workerInputGuard.js", "ocrText.js", "ocrEvaluation.js", "testInputOcr.js", "testWorkerInput.js"]) {
  fs.copyFileSync(path.join(__dirname, name), path.join(root, name));
}
for (const [name, source] of Object.entries(edits)) fs.writeFileSync(path.join(root, name), source);
console.log("PATCHED: worker input checks; shared OCR normalization and language-support warning.");
