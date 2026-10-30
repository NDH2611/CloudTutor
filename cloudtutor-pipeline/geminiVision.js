const { fetchGeminiWithRetry } = require("./geminiRetry");
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

/**
 * Đọc một frame và trả về đánh giá nội dung.
 * useful=false: frame không cung cấp nội dung trực quan hữu ích.
 */
async function describeFrame(frameBytes) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Thieu bien moi truong GEMINI_API_KEY");
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(MODEL)) {
    throw new Error("GEMINI_MODEL khong hop le");
  }

  if (!frameBytes || frameBytes.length === 0) {
    throw new Error("Frame khong co noi dung");
  }

  if (frameBytes.length > 4 * 1024 * 1024) {
    throw new Error("Frame vuot gioi han 4 MB");
  }

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

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    `${MODEL}:generateContent`;

  const response = await fetchGeminiWithRetry(endpoint, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },

    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: Buffer.from(frameBytes).toString("base64"),
              },
            },
          ],
        },
      ],

      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    }),

    // Timeout va retry duoc quan ly trong geminiRetry.
  });

  // Không ghi API key, header hoặc toàn bộ request vào log.
  if (!response.ok) {
    throw new Error(`Gemini API tra ve HTTP ${response.status}`);
  }

  const result = await response.json();
  const candidate = result.candidates?.[0];

  if (!candidate || candidate.finishReason !== "STOP") {
    const reason =
      candidate?.finishReason ||
      result.promptFeedback?.blockReason ||
      "UNKNOWN";

    throw new Error(`Gemini khong tra ket qua hoan tat: ${reason}`);
  }

  const responseText = (candidate.content?.parts || [])
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text)
    .join("\n")
    .trim();

  let parsed;

  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error("Gemini tra ve JSON khong hop le");
  }

  if (
    !parsed ||
    typeof parsed.useful !== "boolean" ||
    typeof parsed.description !== "string"
  ) {
    throw new Error("JSON Gemini thieu useful hoac description hop le");
  }

  const description = parsed.description.trim();

  if (parsed.useful && !description) {
    throw new Error("Gemini danh dau useful nhung mo ta rong");
  }

  return {
    useful: parsed.useful,
    text: parsed.useful ? description : "",
    usage: result.usageMetadata || null,
  };
}

module.exports = { describeFrame };