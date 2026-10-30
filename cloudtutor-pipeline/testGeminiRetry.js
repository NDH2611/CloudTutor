const assert = require("node:assert/strict");
const { fetchGeminiWithRetry } = require("./geminiRetry");

function response(status, retryAfter = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: name => name === "retry-after" ? retryAfter : null,
    },
    body: { cancel: async () => {} },
  };
}

async function runCase(name, sequence, expectedCalls, expectedStatus, code) {
  let calls = 0;
  const waits = [];

  const dependencies = {
    random: () => 0,
    sleep: async ms => { waits.push(ms); },
    fetchImpl: async () => {
      const value = sequence[calls++];
      if (value instanceof Error) throw value;
      return value;
    },
  };

  if (code) {
    await assert.rejects(
      fetchGeminiWithRetry("https://example.invalid", {}, dependencies),
      error => error.code === code
    );
  } else {
    const result = await fetchGeminiWithRetry(
      "https://example.invalid", {}, dependencies
    );
    assert.equal(result.status, expectedStatus);
  }

  assert.equal(calls, expectedCalls);

  if (name === "429 -> 503 -> 200") {
    assert.deepEqual(waits, [1000, 2000]);
  }

  console.log("PASS:", name);
}

async function main() {
  await runCase(
    "429 -> 503 -> 200",
    [response(429), response(503), response(200)],
    3, 200
  );

  await runCase(
    "403 khong retry",
    [response(403)],
    1, 403
  );

  await runCase(
    "503 dung sau 3 lan",
    [response(503), response(503), response(503)],
    3, null, "GEMINI_HTTP_RETRIES_EXHAUSTED"
  );

  await runCase(
    "loi mang -> 200",
    [new TypeError("Simulated network error"), response(200)],
    2, 200
  );

  await runCase(
    "Retry-After 120s -> de SQS retry sau",
    [response(429, "120")],
    1, null, "GEMINI_RETRY_DEFERRED_TO_QUEUE"
  );

  await runCase(
    "timeout -> 200",
    [
      Object.assign(new Error("Simulated timeout"), {
        name: "TimeoutError",
      }),
      response(200),
    ],
    2, 200
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});