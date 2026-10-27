const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;

let currentScenario;
let savedKeys;
let calls;

class GetTranscriptionJobCommand {
  constructor(input) {
    this.input = input;
  }
}

class PutObjectCommand {
  constructor(input) {
    this.input = input;
  }
}

class UpdateItemCommand {
  constructor(input) {
    this.input = input;
  }
}

class TranscribeClient {
  async send(command) {
    assert.ok(command instanceof GetTranscriptionJobCommand);

    return {
      TranscriptionJob: {
        TranscriptionJobStatus: currentScenario.status,
        FailureReason:
          currentScenario.status === "FAILED"
            ? "Simulated failure"
            : undefined,
        Media: {
          MediaFileUri:
            "s3://test-bucket/videos/test-user/test-job/source.mp4",
        },
        Transcript: {
          TranscriptFileUri: "https://example.invalid/transcript",
        },
      },
    };
  }
}

class S3Client {
  async send(command) {
    assert.ok(command instanceof PutObjectCommand);
    savedKeys.push(command.input.Key);
    return {};
  }
}

class DynamoDBClient {
  async send(command) {
    assert.ok(command instanceof UpdateItemCommand);
    calls.markFailed.push(command.input);
    return {};
  }
}

Module._load = function(request, parent, isMain) {
  if (request === "@aws-sdk/client-transcribe") {
    return {
      TranscribeClient,
      GetTranscriptionJobCommand,
    };
  }

  if (request === "@aws-sdk/client-s3") {
    return {
      S3Client,
      PutObjectCommand,
    };
  }

  if (request === "@aws-sdk/client-dynamodb") {
    return {
      DynamoDBClient,
      UpdateItemCommand,
    };
  }

  if (request === "./publishTranscript") {
    return {
      publishTranscript: async () => {
        throw new Error("Khong duoc goi publishTranscript truc tiep");
      },
    };
  }

  if (request === "./startOcrFallback") {
    return {
      startOcrFallback: async (input) => {
        calls.startOcr.push(input);
        return "simulated-mediaconvert-job";
      },
    };
  }

  if (request === "./asrJobState") {
    return {
      getAsrJobState: async () => ({
        skipped: false,
        processingVersion: "test-version",
        status: "PROCESSING_ASR",
      }),

      markProcessingOcr: async (input) => {
        calls.markOcr.push(input);
        return { skipped: false };
      },
    };
  }

  if (request === "./recoverTextHandoff") {
    return {
      recoverTextHandoff: async () => ({
        action: "PROCESS",
      }),
    };
  }

  if (request === "./stageTextResult") {
    return {
      stageTextResult: async (input) => {
        calls.stage.push(input);
      },
    };
  }

  if (request === "./dispatchTextHandoff") {
    return {
      dispatchTextHandoff: async (input) => {
        calls.dispatch.push(input);
      },
    };
  }

  return originalLoad.apply(this, arguments);
};

process.env.MEDIA_BUCKET = "test-bucket";

global.fetch = async () => ({
  ok: true,
  status: 200,

  json: async () => ({
    results: {
      transcripts: [
        {
          transcript: currentScenario.text,
        },
      ],

      items: currentScenario.text
        ? [
            {
              type: "pronunciation",
              start_time: "0.0",
              end_time: "1.0",
              alternatives: [{ content: currentScenario.text }],
            },
          ]
        : [],
    },
  }),
});

const { handler } = require("./ontranscribedone");

const event = {
  detail: {
    TranscriptionJobName: "transcribe-cloudtutor-test-job",
  },
};

function reset(scenario) {
  currentScenario = scenario;
  savedKeys = [];

  calls = {
    stage: [],
    dispatch: [],
    markOcr: [],
    startOcr: [],
    markFailed: [],
  };
}

async function main() {
  // 1. ASR có chữ: lưu S3, tạo checkpoint, bàn giao AI.
  reset({
    status: "COMPLETED",
    text: "hello",
  });

  await handler(event);

  assert.ok(savedKeys.includes(
    "results/test-user/test-job/asr-output.json"
  ));

  assert.ok(savedKeys.includes(
    "results/test-user/test-job/normalized-transcript.json"
  ));

  assert.equal(calls.stage.length, 1);
  assert.equal(calls.dispatch.length, 1);
  assert.equal(calls.stage[0].source, "ASR");
  assert.equal(calls.startOcr.length, 0);
  assert.equal(calls.markFailed.length, 0);

  console.log("PASS: ASR co chu -> checkpoint va ban giao AI");

  // 2. ASR rỗng: chuyển OCR, không gửi AI.
  reset({
    status: "COMPLETED",
    text: "",
  });

  await handler(event);

  assert.equal(calls.markOcr.length, 1);
  assert.equal(calls.startOcr.length, 1);
  assert.equal(calls.startOcr[0].processingVersion, "test-version");
  assert.equal(calls.stage.length, 0);
  assert.equal(calls.dispatch.length, 0);
  assert.ok(savedKeys.includes(
    "results/test-user/test-job/ocr-job.json"
  ));

  console.log("PASS: ASR rong -> khoi dong OCR, khong gui AI");

  // 3. Dịch vụ Transcribe FAILED: ghi lỗi và cập nhật Jobs.
  reset({
    status: "FAILED",
    text: "",
  });

  await handler(event);

  assert.ok(savedKeys.includes(
    "results/test-user/test-job/asr-failure.json"
  ));

  assert.equal(calls.markFailed.length, 1);

  const update = calls.markFailed[0];

  assert.equal(
    update.ExpressionAttributeValues[":failed"].S,
    "FAILED"
  );

  assert.equal(
    update.ExpressionAttributeValues[":error"].S,
    "ASR_SERVICE_FAILED"
  );

  assert.equal(calls.dispatch.length, 0);
  assert.equal(calls.startOcr.length, 0);

  console.log("PASS: ASR loi -> ghi failure va cap nhat FAILED");
}

main().catch((error) => {
  console.error("TEST THAT BAI:", error);
  process.exitCode = 1;
});