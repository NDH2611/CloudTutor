"use strict";
class VisionError extends Error {
  constructor(code, { retryable = false, status, retrySeconds = 120, daily = false, attempted = true } = {}) {
    super(code); this.name = "VisionError"; this.code = code;
    this.retryable = retryable; this.status = status;
    this.retrySeconds = retrySeconds; this.daily = daily; this.attempted = attempted;
  }
}
module.exports = { VisionError };
