"use strict";
const { spawnSync } = require("node:child_process");
const tests = ["testInputOcr.js", "testWorkerInput.js", "testRecoveryRules.js", "testVisionHardening.js", "testVisionQuotaRecovery.js"];
for (const file of tests) {
  console.log(`\n========== ${file} ==========`);
  const result = spawnSync(process.execPath, [file], { cwd: __dirname, stdio: "inherit" });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log("\nPASS: all five local test suites.");