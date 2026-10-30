const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

function retryAfterMs(response, now) {
  const value = response.headers?.get("retry-after");
  if (!value) return 0;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

function safeError(code, status) {
  const error = new Error(code);
  error.code = code;
  if (status !== undefined) error.status = status;
  return error;
}

async function fetchGeminiWithRetry(url, options, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const sleep = dependencies.sleep ||
    (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const random = dependencies.random || Math.random;
  const now = dependencies.now || Date.now;

  const deadline = now() + 70000;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const remaining = deadline - now();

    if (remaining <= 0) {
      throw safeError("GEMINI_RETRY_BUDGET_EXHAUSTED");
    }

    let response;
    let networkFailure = false;

    try {
      response = await fetchImpl(url, {
        ...options,
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(20000, Math.floor(remaining)))
        ),
      });
    } catch (error) {
      if (!["TypeError", "TimeoutError", "AbortError"]
        .includes(error.name)) {
        throw error;
      }

      networkFailure = true;
    }

    // Lỗi cố định như 400/401/403 được trả về cho caller xử lý.
    if (response && !RETRYABLE.has(response.status)) {
      return response;
    }

    const status = response?.status;
    const requestedWait = response
      ? retryAfterMs(response, now())
      : 0;

    // Giải phóng body của response sẽ không sử dụng.
    if (response?.body) {
      try {
        await response.body.cancel();
      } catch {
        // Không thay lỗi chính bằng lỗi giải phóng response.
      }
    }

    if (attempt === 3) {
      throw safeError(
        networkFailure
          ? "GEMINI_NETWORK_RETRIES_EXHAUSTED"
          : "GEMINI_HTTP_RETRIES_EXHAUSTED",
        status
      );
    }

    const backoff = 1000 * (2 ** (attempt - 1))
      + Math.floor(random() * 500);
    const delay = Math.max(backoff, requestedWait);

    // Để SQS retry ở lượt sau nếu server yêu cầu chờ dài.
    if (delay > 5000 || delay + 1000 >= deadline - now()) {
      throw safeError("GEMINI_RETRY_DEFERRED_TO_QUEUE", status);
    }

    // Không log URL, API key, request body hoặc mô tả frame.
    console.warn(JSON.stringify({
      event: "GEMINI_RETRY",
      attempt,
      status: status || "NETWORK_ERROR",
      delay_ms: delay,
    }));

    await sleep(delay);
  }
}

module.exports = { fetchGeminiWithRetry };