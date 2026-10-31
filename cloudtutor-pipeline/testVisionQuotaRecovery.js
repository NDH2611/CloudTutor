"use strict";
const assert = require("node:assert/strict");
const { eligible } = require("./recoveryRules");
const now = Date.parse("2026-10-31T12:00:00Z");
const job = { job_id: "job-1", owner_id: "owner-1", processing_version: "v-1",
  status: "PROCESSING_VISION", vision_retry_state: "WAITING", vision_retry_version: "v-1",
  updated_at: "2026-10-31T10:00:00Z", next_retry_at: now / 1000 - 60 };
assert.equal(eligible(job, { now }), null);
assert.equal(eligible({ ...job, next_retry_at: now / 1000 + 60 }, { now }), "VISION_RETRY_NOT_DUE");
assert.equal(eligible({ ...job, vision_retry_state: undefined }, { now }), "STATUS_NOT_RECOVERABLE");
assert.equal(eligible({ ...job, vision_retry_version: "old" }, { now }), "INVALID_IDENTITY");
assert.equal(eligible({ ...job, test_fixture: true }, { now }), "TEST_FIXTURE_EXCLUDED");
assert.equal(eligible({ ...job, updated_at: new Date(now - 60000).toISOString() }, { now }), "NOT_STALE");
console.log("PASS: 6 due-quota recovery checks");
