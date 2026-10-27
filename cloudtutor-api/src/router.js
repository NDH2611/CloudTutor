const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const crypto = require("crypto");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const JOBS = process.env.JOBS_TABLE,
  RESULTS = process.env.RESULTS_TABLE,
  BUCKET = process.env.BUCKET;
const ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const URL_TTL = 900;

const res = (code, body) => ({
  statusCode: code,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ORIGIN,
  },
  body: JSON.stringify(body),
});

const ownerOf = (e) => e.requestContext?.authorizer?.jwt?.claims?.sub;

async function getOwnedJob(jobId, owner) {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: JOBS, Key: { job_id: jobId } }),
  );
  if (
    !Item ||
    Item.owner_id !== owner ||
    ["DELETING", "DELETED"].includes(Item.status)
  )
    return null;
  return Item;
}

async function readJson(key) {
  try {
    const o = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return JSON.parse(await o.Body.transformToString());
  } catch {
    return null;
  }
}

async function createJob(e, owner) {
  const body = JSON.parse(e.body || "{}");
  const filename = String(body.filename || "source.mp4").slice(0, 200);
  const jobId = "job_" + crypto.randomUUID();
  const videoKey = `videos/${owner}/${jobId}/source.mp4`;
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: JOBS,
      Item: {
        job_id: jobId,
        owner_id: owner,
        status: "CREATED",
        video_key: videoKey,
        original_filename: filename,
        created_at: now,
        updated_at: now,
      },
      ConditionExpression: "attribute_not_exists(job_id)",
    }),
  );
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: videoKey,
      ContentType: "video/mp4",
    }),
    { expiresIn: URL_TTL },
  );
  return res(201, {
    job_id: jobId,
    status: "CREATED",
    upload_url: uploadUrl,
    upload_headers: { "Content-Type": "video/mp4" },
    expires_in: URL_TTL,
  });
}

async function listJobs(e, owner) {
  const limit = Math.min(
    parseInt(e.queryStringParameters?.limit || "20", 10),
    50,
  );
  const next = e.queryStringParameters?.next_token;
  const r = await ddb.send(
    new QueryCommand({
      TableName: JOBS,
      IndexName: "owner-created-at-index",
      KeyConditionExpression: "owner_id = :o",
      ExpressionAttributeValues: { ":o": owner },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: next
        ? JSON.parse(Buffer.from(next, "base64url").toString())
        : undefined,
    }),
  );
  const items = r.Items.filter(
    (j) => !["DELETING", "DELETED"].includes(j.status),
  ).map(({ job_id, status, original_filename, created_at }) => ({
    job_id,
    status,
    original_filename,
    created_at,
  }));
  return res(200, {
    items,
    next_token: r.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(r.LastEvaluatedKey)).toString("base64url")
      : null,
  });
}

async function getJob(jobId, owner) {
  const job = await getOwnedJob(jobId, owner);
  if (!job) return res(404, { error: "NOT_FOUND" });
  const out = {
    job_id: job.job_id,
    status: job.status,
    original_filename: job.original_filename,
    created_at: job.created_at,
    warnings: job.warnings || [],
    error_code: job.error_code || null,
  };
  if (["COMPLETED", "COMPLETED_WITH_WARNING"].includes(job.status)) {
    const { Item: r } = await ddb.send(
      new GetCommand({ TableName: RESULTS, Key: { job_id: jobId } }),
    );
    out.content_source = r?.content_source || null;
    const prefix = `results/${owner}/${jobId}/`;
    out.transcript = await readJson(
      r?.transcript_key || prefix + "transcript.json",
    );
    out.chunks = await readJson(r?.chunks_key || prefix + "chunks.json");
    out.summary = await readJson(r?.summary_key || prefix + "summary.json");
    out.quiz = await readJson(r?.quiz_key || prefix + "quiz.json");
  }
  out.video_url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: job.video_key }),
    { expiresIn: URL_TTL },
  );
  return res(200, out);
}

async function deleteJob(jobId, owner) {
  const job = await getOwnedJob(jobId, owner);
  if (!job) return res(404, { error: "NOT_FOUND" });
  await ddb.send(
    new UpdateCommand({
      TableName: JOBS,
      Key: { job_id: jobId },
      UpdateExpression: "SET #s = :d, updated_at = :t REMOVE share_token_hash",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":d": "DELETING",
        ":t": new Date().toISOString(),
      },
    }),
  );
  for (const p of ["videos", "frames", "derived", "results"]) {
    let token;
    do {
      const l = await s3.send(
        new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: `${p}/${owner}/${jobId}/`,
          ContinuationToken: token,
        }),
      );
      if (l.Contents?.length)
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: BUCKET,
            Delete: { Objects: l.Contents.map((o) => ({ Key: o.Key })) },
          }),
        );
      token = l.NextContinuationToken;
    } while (token);
  }
  await ddb.send(
    new UpdateCommand({
      TableName: JOBS,
      Key: { job_id: jobId },
      UpdateExpression: "SET #s = :d, updated_at = :t",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":d": "DELETED",
        ":t": new Date().toISOString(),
      },
    }),
  );
  return res(200, { job_id: jobId, status: "DELETED" });
}

exports.handler = async (e) => {
  try {
    const owner = ownerOf(e);
    if (!owner) return res(401, { error: "UNAUTHORIZED" });
    const id = e.pathParameters?.id;
    switch (e.routeKey) {
      case "POST /jobs":
        return await createJob(e, owner);
      case "GET /jobs":
        return await listJobs(e, owner);
      case "GET /jobs/{id}":
        return await getJob(id, owner);
      case "DELETE /jobs/{id}":
        return await deleteJob(id, owner);
      default:
        return res(404, { error: "ROUTE_NOT_FOUND" });
    }
  } catch (err) {
    console.error(err);
    return res(500, { error: "INTERNAL_ERROR" });
  }
};
