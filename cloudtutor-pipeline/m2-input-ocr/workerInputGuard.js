"use strict";
const { UpdateItemCommand } = require("@aws-sdk/client-dynamodb");
const { validateVideoInput, VideoInputError } = require("./validateVideoInput");
// Chỉ đánh dấu FAILED cho job mới đúng owner/key; không ghi đè phiên đang chạy.
async function guardInitialVideo({ dynamodb, jobsTable, jobId, ownerId, videoKey, bucket, eventEtag, eventVersionId }) {
  try { return await validateVideoInput({ bucket, key: videoKey, eventEtag, eventVersionId }); }
  catch (error) {
    if (!(error instanceof VideoInputError)) throw error;
    try {
      await dynamodb.send(new UpdateItemCommand({ TableName: jobsTable, Key: { job_id: { S: jobId } },
        ConditionExpression: "#owner = :owner AND #video = :video AND #status IN (:created, :uploaded) AND attribute_not_exists(#version) AND (attribute_not_exists(#deleted) OR #deleted = :empty OR attribute_type(#deleted, :nullType))",
        UpdateExpression: "SET #status = :failed, #error = :error, #updated = :now",
        ExpressionAttributeNames: { "#owner": "owner_id", "#video": "video_key", "#status": "status", "#version": "processing_version", "#deleted": "deleted_at", "#error": "error_code", "#updated": "updated_at" },
        ExpressionAttributeValues: { ":owner": { S: ownerId }, ":video": { S: videoKey }, ":created": { S: "CREATED" }, ":uploaded": { S: "UPLOADED" },
          ":empty": { S: "" }, ":nullType": { S: "NULL" }, ":failed": { S: "FAILED" }, ":error": { S: error.code }, ":now": { S: new Date().toISOString() } }
      }));
    } catch (updateError) {
      if (updateError.name !== "ConditionalCheckFailedException") throw updateError;
      return { skipped: true, reason: "INPUT_REJECTION_CONCURRENT_JOB_CHANGE" };
    }
    console.warn(JSON.stringify({ event: "VIDEO_INPUT_REJECTED", job_id: jobId, error_code: error.code }));
    return { skipped: true, reason: error.code };
  }
}
module.exports = { guardInitialVideo };
