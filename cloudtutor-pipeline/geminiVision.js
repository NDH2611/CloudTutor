"use strict";
const { fetchGeminiWithRetry } = require("./geminiRetry");
const { getGeminiKey } = require("./geminiSecret");
const { checkQuota, pauseQuota } = require("./visionQuota");
const { cacheKey, readFrameCache, writeFrameCache } = require("./visionFrameCache");
const { metric } = require("./visionMetrics");
const { VisionError } = require("./visionErrors");
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

async function describeFrame(frameBytes, identity = {}) {
  if (!/^[a-zA-Z0-9._-]+$/.test(MODEL)) throw new Error("GEMINI_MODEL_INVALID");
  if (!frameBytes?.length || frameBytes.length > 4 * 1024 * 1024) throw new Error("VISION_FRAME_SIZE_INVALID");
  const key = cacheKey(frameBytes, identity);
  const cached = await readFrameCache(key, identity);
  if (cached) { metric("FrameCacheHits"); return { ...cached, cache_hit: true }; }

  await checkQuota();
  const apiKey = await getGeminiKey();
  const prompt = [
    "Phân tích một khung hình trong video cho CloudTutor.",
    "Chỉ dựa vào những gì có thể quan sát được trong ảnh.",
    "Không suy đoán lời nói, danh tính hoặc diễn biến ngoài ảnh.",
    "Không tự đặt mốc thời gian.",
    "Trả về duy nhất một đối tượng JSON gồm:",
    '"useful": boolean và "description": string.',
    "Đặt useful là false nếu ảnh hoàn toàn trống, đen, trắng,",
    "hoặc không có nội dung trực quan có thể mô tả hữu ích.",
    "Khi useful là false, description phải là chuỗi rỗng.",
    "Khi useful là true, description mô tả bằng tiếng Việt",
    "những nội dung quan sát được trong ảnh.",
  ].join(" ");

  let response;
  try {
    response = await fetchGeminiWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt },
          { inlineData: { mimeType: "image/jpeg", data: Buffer.from(frameBytes).toString("base64") } }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024, responseMimeType: "application/json" } }),
      });
  } catch (error) {
    if (error instanceof VisionError && error.retryable) await pauseQuota(error);
    throw error;
  }
  if (!response.ok) throw new VisionError("GEMINI_HTTP_PERMANENT", { status: response.status });

  let result;
  try { result = await response.json(); }
  catch {
    metric("InvalidOutput");
    throw new VisionError("GEMINI_RESPONSE_BODY_INVALID", { retryable: true });
  }
  const usage = result.usageMetadata || null;
  if (usage) {
    metric("PromptTokens", Number(usage.promptTokenCount || 0));
    metric("OutputTokens", Number(usage.candidatesTokenCount || 0));
    metric("TotalTokens", Number(usage.totalTokenCount || 0));
  }
  const candidate = result.candidates?.[0];
  const responseText = (candidate?.content?.parts || [])
    .filter(part => part.text && !part.thought).map(part => part.text).join("\n").trim();
  let parsed;
  try { parsed = JSON.parse(responseText); } catch { /* kiểm tra bên dưới */ }
  if (candidate?.finishReason !== "STOP" || !parsed || typeof parsed.useful !== "boolean" ||
      typeof parsed.description !== "string" || (parsed.useful && !parsed.description.trim())) {
    metric("InvalidOutput");
    throw new VisionError("GEMINI_OUTPUT_INVALID", { retryable: true });
  }
  const value = { useful: parsed.useful, text: parsed.useful ? parsed.description.trim() : "", usage };
  const saved = await writeFrameCache(key, identity, value);
  return { ...saved, cache_hit: false };
}
module.exports = { describeFrame };
