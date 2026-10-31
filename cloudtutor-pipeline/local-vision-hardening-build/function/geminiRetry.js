"use strict";
const { VisionError } = require("./visionErrors");
const { metric } = require("./visionMetrics");
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

function errorInfo(payload, header, now) {
  let seconds = 0;
  if (header) {
    const numeric = Number(header);
    seconds = Number.isFinite(numeric) && numeric >= 0
      ? numeric : Math.max(0, (Date.parse(header) - now) / 1000) || 0;
  }
  let daily = false;
  for (const detail of payload?.error?.details || []) {
    if (String(detail["@type"]).endsWith("google.rpc.RetryInfo")) {
      const match = /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay || "");
      if (match) seconds = Math.max(seconds, Number(match[1]));
    }
    if (String(detail["@type"]).endsWith("google.rpc.QuotaFailure")) {
      for (const violation of detail.violations || []) {
        if (/perday|per_day|daily/i.test(
          `${violation.quotaId || ""} ${violation.quotaMetric || ""}`
        )) daily = true;
      }
    }
  }
  return { daily, seconds: Math.ceil(seconds) };
}

async function readError(response) {
  // Google error body chỉ được phân tích trong bộ nhớ, không log.
  if (!response.body?.getReader) {
    try { return await response.json(); } catch { return {}; }
  }
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 65536) { await reader.cancel(); return {}; }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return {}; }
  finally { reader.releaseLock(); }
}

async function fetchGeminiWithRetry(url, options, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const sleep = dependencies.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const random = dependencies.random || Math.random;
  const now = dependencies.now || Date.now;
  const deadline = now() + 70000;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new VisionError("GEMINI_RETRY_BUDGET_EXHAUSTED", { retryable: true });
    let response;
    const started = now();
    metric("GeminiRequests");
    try {
      response = await fetchImpl(url, { ...options,
        signal: AbortSignal.timeout(Math.max(1, Math.min(20000, Math.floor(remaining)))),
      });
    } catch (error) {
      if (!["TypeError", "TimeoutError", "AbortError"].includes(error.name)) {
        throw new VisionError("GEMINI_TRANSPORT_ERROR", { retryable: true });
      }
    }
    metric("GeminiLatencyMs", Math.max(0, now() - started));
    if (response && !RETRYABLE.has(response.status)) return response;
    const status = response?.status;
    if (status === 429) metric("Gemini429");
    if (status >= 500) metric("Gemini5xx");
    const info = response
      ? errorInfo(await readError(response), response.headers?.get("retry-after"), now())
      : { daily: false, seconds: 0 };
    if (info.daily) {
      metric("DailyQuota");
      // Kiểm tra lại sau 6h, không tuyên bố đây là thời điểm quota reset.
      throw new VisionError("GEMINI_DAILY_QUOTA", {
        retryable: true, status, daily: true,
        retrySeconds: Math.max(21600, info.seconds),
      });
    }
    const wait = Math.max(1000 * 2 ** (attempt - 1) + Math.floor(random() * 500), info.seconds * 1000);
    if (attempt === 3 || wait > 5000 || wait + 1000 >= deadline - now()) {
      throw new VisionError(status === 429 ? "GEMINI_RATE_LIMITED" : "GEMINI_TEMPORARY_FAILURE", {
        retryable: true, status,
        retrySeconds: Math.max(status === 429 ? 900 : 120, info.seconds),
      });
    }
    metric("GeminiRetries");
    await sleep(wait);
  }
}
module.exports = { fetchGeminiWithRetry, errorInfo };
