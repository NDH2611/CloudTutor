import json
import logging
import os
import boto3

from chunkTranscript import chunk_transcript
from generateSummary import generate_summary
from generateQuiz import generate_quiz

logging.basicConfig(level=logging.INFO, force=True)
logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client("s3")

def lambda_handler(event, context):
    logger.info(f"Nhận sự kiện SQS: {json.dumps(event)}")
    
    for record in event.get("Records", []):
        try:
            body_str = record.get("body", "{}")
            message = json.loads(body_str)
            
            bucket = message.get("bucket")
            transcript_key = message.get("transcript_key")
            job_id = message.get("job_id")
            owner_id = message.get("owner_id")
            
            if not bucket or not transcript_key:
                logger.error(f"Thiếu thông tin bucket hoặc transcript_key trong message: {message}")
                continue
                
            logger.info(f"Đang xử lý job {job_id} của owner {owner_id} từ bucket {bucket}, key {transcript_key}")
            
            # 1. Tải tệp transcript từ S3
            response = s3_client.get_object(Bucket=bucket, Key=transcript_key)
            transcript_content = response["Body"].read().decode("utf-8")
            transcript_data = json.loads(transcript_content)
            
            # 2. Thực hiện chia chunk dữ liệu
            chunk_data = chunk_transcript(transcript_data)
            
            # Xác định thư mục lưu trữ đích (cùng thư mục với transcript_key)
            path_dir = os.path.dirname(transcript_key)
            chunk_key = f"{path_dir}/chunk.json" if path_dir else "chunk.json"
            summary_key = f"{path_dir}/summary.json" if path_dir else "summary.json"
            quiz_key = f"{path_dir}/quizz.json" if path_dir else "quizz.json"
            chunk_data["transcript_key"] = chunk_key
            
            # 3. Lưu chunk.json lên S3
            logger.info(f"Đang tải chunk.json lên s3://{bucket}/{chunk_key}")
            s3_client.put_object(
                Bucket=bucket,
                Key=chunk_key,
                Body=json.dumps(chunk_data, ensure_ascii=False, indent=2),
                ContentType="application/json"
            )
            
            # 4. Tạo và lưu summary.json lên S3 (Sử dụng Google AI thông qua module generate_summary)
            summary_data = generate_summary(chunk_data)
            logger.info(f"Đang tải summary.json lên s3://{bucket}/{summary_key}")
            s3_client.put_object(
                Bucket=bucket,
                Key=summary_key,
                Body=json.dumps(summary_data, ensure_ascii=False, indent=2),
                ContentType="application/json"
            )
            
            # 5. Tạo và lưu quizz.json lên S3 (Sử dụng Google AI thông qua module generate_quiz)
            quiz_data = generate_quiz(chunk_data)
            logger.info(f"Đang tải quizz.json lên s3://{bucket}/{quiz_key}")
            s3_client.put_object(
                Bucket=bucket,
                Key=quiz_key,
                Body=json.dumps(quiz_data, ensure_ascii=False, indent=2),
                ContentType="application/json"
            )
            
            logger.info(f"Hoàn tất xử lý thành công job {job_id}.")

        except Exception as e:
            logger.error(f"Lỗi khi xử lý bản ghi SQS: {str(e)}", exc_info=True)
            raise e

    return {
        "statusCode": 200,
        "body": json.dumps("Xử lý thành công các message từ SQS và tạo các tệp kết quả trên S3.")
    }
