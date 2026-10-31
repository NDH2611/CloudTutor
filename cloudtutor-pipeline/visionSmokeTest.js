const {
  S3Client,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const BUCKET = process.env.MEDIA_BUCKET;

async function describeFrame(frameBytes) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Thieu bien moi truong GEMINI_API_KEY");
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(MODEL)) {
    throw new Error("GEMINI_MODEL khong hop le");
  }

  const prompt = [
    "Bạn đang mô tả một khung hình từ video cho CloudTutor.",
    "Viết bằng tiếng Việt từ 3 đến 5 câu.",
    "Chỉ mô tả nội dung có thể quan sát được trong ảnh.",
    "Không suy đoán lời nói, danh tính hoặc diễn biến ngoài ảnh.",
    "Không tự đặt mốc thời gian.",
    "Nếu ảnh không có nội dung hữu ích, hãy nói rõ.",
  ].join(" ");

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${MODEL}:generateContent`;

  const response = await fetch(endpoint, {
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
      },
    }),

    signal: AbortSignal.timeout(90000),
  });

  // Không ghi request, header hoặc API key vào log.
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

  const text = (candidate.content?.parts || [])
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Gemini tra ve van ban rong");
  }

  return {
    text,
    usage: result.usageMetadata || null,
  };
}

exports.handler = async (event) => {
  if (!BUCKET) {
    throw new Error("Thieu bien moi truong MEDIA_BUCKET");
  }

  const frameKey = event?.frame_key;

  // Chỉ cho thử ảnh JPG trong prefix frames/.
  if (
    typeof frameKey !== "string" ||
    !frameKey.startsWith("frames/") ||
    !frameKey.toLowerCase().endsWith(".jpg") ||
    frameKey.includes("..")
  ) {
    throw new Error("frame_key phai tro den anh JPG trong frames/");
  }

  console.log("Dang kiem tra frame:", frameKey);

  const object = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: frameKey,
    })
  );

  if (!object.Body) {
    throw new Error("Frame khong co noi dung");
  }

  // Giới hạn cho phép thử một ảnh.
  if (object.ContentLength > 4 * 1024 * 1024) {
    throw new Error("Frame vuot 4 MB");
  }

  const frameBytes = await object.Body.transformToByteArray();

  if (frameBytes.length === 0 || frameBytes.length > 4 * 1024 * 1024) {
    throw new Error("Kich thuoc frame khong hop le");
  }

  const result = await describeFrame(frameBytes);

  return {
    test: "VISION_SMOKE_TEST",
    model: MODEL,
    source: "VISION",
    frame_key: frameKey,
    description: result.text,
    usage: result.usage,
    warnings: ["AI_GENERATED_VISUAL_DESCRIPTION"],
  };
};