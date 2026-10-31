"use strict";
const allowed = new Set([
  "GeminiRequests", "Gemini429", "Gemini5xx", "GeminiLatencyMs", "GeminiRetries",
  "PromptTokens", "OutputTokens", "TotalTokens", "InvalidOutput", "DailyQuota",
  "SecretReadErrors", "DeferredJobs", "TerminalFailures", "FrameCacheHits",
]);
function metric(name, value = 1) {
  if (!allowed.has(name) || !Number.isFinite(value) || value < 0) return;
  console.log(JSON.stringify({
    _aws: { Timestamp: Date.now(), CloudWatchMetrics: [{
      Namespace: "CloudTutor/Vision", Dimensions: [["FunctionName", "Model"]],
      Metrics: [{ Name: name, Unit: name.endsWith("Ms") ? "Milliseconds" : "Count" }],
    }] },
    FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME || "local-test",
    Model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    [name]: value,
  }));
}
module.exports = { metric };
