# trong lambda file này sử dụng tên lamda_function.py 

import json
import logging
import os
import boto3
from botocore.exceptions import ClientError
from datetime import datetime, timezone

from chunkTranscript import chunk_transcript
from generateStudyContent import generate_study_content

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client("s3")
sqs_client = boto3.client("sqs")
dynamodb = boto3.resource("dynamodb")

JOBS_TABLE_NAME = os.environ.get("JOBS_TABLE_NAME", "ddb-cloudtutor-jobs")
RESULTS_TABLE_NAME = os.environ.get("RESULTS_TABLE_NAME", "ddb-cloudtutor-results")

jobs_table = dynamodb.Table(JOBS_TABLE_NAME)
results_table = dynamodb.Table(RESULTS_TABLE_NAME)

def update_job_status(job_id: str, status: str, additional_attributes: dict = None):
    try:
        update_expression = "SET #st = :st, updated_at = :uat"
        expression_attribute_names = {"#st": "status"}
        expression_attribute_values = {
            ":st": status,
            ":uat": datetime.now(timezone.utc).isoformat()
        }
        
        if additional_attributes:
            for k, v in additional_attributes.items():
                update_expression += f", #{k} = :{k}"
                expression_attribute_names[f"#{k}"] = k
                expression_attribute_values[f":{k}"] = v

        jobs_table.update_item(
            Key={"job_id": job_id},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_attribute_names,
            ExpressionAttributeValues=expression_attribute_values
        )
        logger.info("Đã cập nhật trạng thái job %s thành %s trên DynamoDB", job_id, status)
    except Exception as e:
        logger.exception("Không thể cập nhật trạng thái job lên DynamoDB: %s", str(e))
        raise

def save_results_to_dynamodb(job_id: str, transcript_key: str, chunks_key: str, summary_key: str, quiz_key: str, content_source: str):
    try:
        results_table.put_item(
            Item={
                "job_id": job_id,
                "transcript_key": transcript_key,
                "chunks_key": chunks_key,
                "summary_key": summary_key,
                "quiz_key": quiz_key,
                "content_source": content_source
            }
        )
        logger.info("Đã lưu tham chiếu kết quả vào bảng ddb-cloudtutor-results cho job_id: %s", job_id)
    except Exception as e:
        logger.exception("Không thể lưu kết quả vào DynamoDB results table: %s", str(e))
        raise

def lambda_handler(event, context):
    logger.info("Bắt đầu xử lý sự kiện SQS AI: %s", json.dumps(event))
    batch_item_failures = []

    for record in event.get("Records", []):
        message_body = record.get("body", "{}")
        job_id = None
        try:
            body_data = json.loads(message_body)
            job_id = body_data.get("job_id")
            owner_id = body_data.get("owner_id")
            bucket = body_data.get("bucket")
            transcript_key = body_data.get("transcript_key")
            source = body_data.get("source", "ASR")

            if not job_id or not bucket or not transcript_key:
                raise ValueError(f"Thiếu thông tin bắt buộc trong message: {message_body}")

            # Cập nhật trạng thái sang PROCESSING_AI trên DynamoDB
            update_job_status(job_id, "PROCESSING_AI")

            logger.info("Đang đọc transcript từ S3 - Bucket: %s, Key: %s", bucket, transcript_key)

            # 2. Lấy dữ liệu transcript từ S3
            s3_response = s3_client.get_object(Bucket=bucket, Key=transcript_key)
            transcript_content = s3_response["Body"].read().decode("utf-8")
            transcript_data = json.loads(transcript_content)

            # 3. Tạo chunk.json
            logger.info("Tiến hành chia chunk cho job_id: %s", job_id)
            chunk_result = chunk_transcript(transcript_data)
            
            chunks_key = f"results/{owner_id}/{job_id}/chunks.json"
            s3_client.put_object(
                Bucket=bucket,
                Key=chunks_key,
                Body=json.dumps(chunk_result, ensure_ascii=False, indent=2),
                ContentType="application/json"
            )

            # 4. Gọi AI sinh Summary và Quiz
            logger.info("Đang gọi AI sinh Summary và Quiz cho job_id: %s", job_id)
            study_content = generate_study_content(chunk_result)

            summary_data = study_content.get("summary", study_content)
            quiz_data = study_content.get("quiz", study_content)

            # 5. Lưu summary.json và quiz.json lên S3
            summary_key = f"results/{owner_id}/{job_id}/summary.json"
            quiz_key = f"results/{owner_id}/{job_id}/quiz.json"

            s3_client.put_object(
                Bucket=bucket, Key=summary_key,
                Body=json.dumps(summary_data, ensure_ascii=False, indent=2),
                ContentType="application/json"
            )
            s3_client.put_object(
                Bucket=bucket, Key=quiz_key,
                Body=json.dumps(quiz_data, ensure_ascii=False, indent=2),
                ContentType="application/json"
            )

            # 6. Lưu tham chiếu kết quả vào ddb-cloudtutor-results
            save_results_to_dynamodb(job_id, transcript_key, chunks_key, summary_key, quiz_key, source)

            # 7. Cập nhật trạng thái hoàn tất COMPLETED
            update_job_status(job_id, "COMPLETED")
            logger.info("Xử lý thành công toàn bộ nội dung học tập cho job_id: %s", job_id)

        except Exception as e:
            logger.exception("Lỗi xử lý record SQS: %s", str(e))
            if job_id:
                try:
                    update_job_status(job_id, "FAILED", {"error_code": str(type(e).__name__)})
                except Exception as db_err:
                    logger.error("Không thể cập nhật trạng thái FAILED vào DynamoDB: %s", str(db_err))

            # Trả về itemIdentifier để SQS biết message này lỗi và tự động tăng số lần retry lên (tối đa 5 lần)
            batch_item_failures.append({"itemIdentifier": record["messageId"]})

    return {"batchItemFailures": batch_item_failures}
