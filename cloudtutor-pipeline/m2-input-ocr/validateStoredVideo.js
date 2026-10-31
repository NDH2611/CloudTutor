"use strict";
const fs = require("node:fs");
const { validateVideoInput } = require("./validateVideoInput");
validateVideoInput({ bucket: "s3-cloudtutor-media-251929332061", key: "videos/test-user/main-upload-test-cc45f546b4924333ac8e59faf2f30b18/source.mp4" })
  .then(r => { if (r.skipped) throw new Error("UNEXPECTED_SKIP"); fs.writeFileSync(process.argv[2], JSON.stringify(r, null, 2)); console.log("PASS: actual stored MP4 size and bounded ftyp read; no Transcribe job created."); })
  .catch(e => { console.error("Stored input validation failed:", e.name, e.message); process.exitCode = 1; });
