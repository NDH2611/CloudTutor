"use strict";
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { metric } = require("./visionMetrics");
const client = new SecretsManagerClient({ region: process.env.AWS_REGION || "ap-southeast-1", maxAttempts: 2 });

function parseKey(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("GEMINI_SECRET_EMPTY");
  let key;
  if (value.trim().startsWith("{")) {
    let parsed;
    try { parsed = JSON.parse(value); } catch { throw new Error("GEMINI_SECRET_INVALID_JSON"); }
    key = parsed.api_key || parsed.GEMINI_API_KEY;
  } else key = value.trim();
  if (typeof key !== "string" || key.trim().length < 16 || /\s/.test(key.trim())) {
    throw new Error("GEMINI_SECRET_INVALID_KEY");
  }
  return key.trim();
}

function makeKeyReader(fetchValue, now = Date.now) {
  let cached, expires = 0, pending;
  return async () => {
    if (cached && now() < expires) return cached;
    if (!pending) {
      pending = (async () => {
        const value = parseKey(await fetchValue());
        cached = value; expires = now() + 300000;
        return value;
      })().finally(() => { pending = null; });
    }
    return pending;
  };
}

const getGeminiKey = makeKeyReader(async () => {
  const id = process.env.GEMINI_SECRET_ID;
  if (!id) throw new Error("GEMINI_SECRET_ID_MISSING");
  try {
    const response = await client.send(new GetSecretValueCommand({
      SecretId: id, VersionStage: "AWSCURRENT",
    }), { abortSignal: AbortSignal.timeout(5000) });
    return response.SecretString;
  } catch {
    metric("SecretReadErrors");
    // Không đưa lỗi SDK, response hoặc key vào log.
    throw new Error("GEMINI_SECRET_READ_FAILED");
  }
});
module.exports = { getGeminiKey, parseKey, makeKeyReader };
