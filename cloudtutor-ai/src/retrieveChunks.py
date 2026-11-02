
import json
import os
import logging
import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REGION_NAME = "ap-southeast-1"
MEDIA_BUCKET = os.environ.get("MEDIA_BUCKET")
RESULTS_TABLE = os.environ.get("RESULTS_TABLE")

s3_client = boto3.client("s3", region_name=REGION_NAME)
dynamodb = boto3.resource("dynamodb", region_name=REGION_NAME)

def get_chunks_from_job(job_id: str) -> dict:
    if not job_id:
        raise ValueError("Thiếu tham số bắt buộc: job_id")

    logger.info("Đang truy vấn bảng DynamoDB %s cho job_id: %s", RESULTS_TABLE, job_id)
    try:
        table = dynamodb.Table(RESULTS_TABLE)
        response = table.get_item(Key={"job_id": job_id})
        
        item = response.get("Item")
        if not item:
            raise LookupError(f"Không tìm thấy kết quả nào trong DynamoDB cho job_id: {job_id}")

        # Lấy chunks_key từ item của bảng Results, nếu không có thì fallback theo cấu trúc chuẩn S3 prefix
        chunks_key = item.get("chunks_key")
        if not chunks_key:
            owner_id = item.get("owner_id", "test-user")
            chunks_key = f"results/{job_id}/chunks.json"
            logger.warning("Không tìm thấy trường chunks_key trong item, sử dụng đường dẫn mặc định: %s", chunks_key)

        logger.info("Đang tải file chunks từ S3 bucket: %s, key: %s", MEDIA_BUCKET, chunks_key)
        
        s3_obj = s3_client.get_object(Bucket=MEDIA_BUCKET, Key=chunks_key)
        file_content = s3_obj["Body"].read().decode("utf-8")
        chunks_data = json.loads(file_content)

        logger.info("Đã tải thành công dữ liệu chunks cho job_id: %s", job_id)
        return chunks_data
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        logger.exception("Lỗi AWS ClientError khi lấy chunks cho job %s: %s", job_id, error_code)
        raise RuntimeError(f"Lỗi hệ thống AWS [Mã lỗi: {error_code}]") from e
    except json.JSONDecodeError as e:
        logger.exception("File chunks trên S3 không đúng định dạng JSON hợp lệ cho job_id: %s", job_id)
        raise ValueError("Dữ liệu chunks trên S3 bị lỗi định dạng JSON.") from e
