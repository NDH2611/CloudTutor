import os
import json
import logging
from retrieveChunks import get_chunks_from_job
from bedrockService import BedrockService
from geminiService import get_gemini_client

# Cấu hình logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Đọc cấu hình từ biến môi trường
GEMINI_MODEL = os.environ.get("GEMINI_MODEL_ID")

def load_prompt_template() -> str:
    prompt_path = os.path.join(os.path.dirname(__file__), "prompts", "prompt.txt")
    if os.path.exists(prompt_path):
        with open(prompt_path, "r", encoding="utf-8") as f:
            return f.read()
    return "Dựa vào các chunk sau:\n{chunks}\nHãy trả lời câu hỏi: {question}"

def lambda_handler(event, context):
    logger.info("Nhận request Q&A event: %s", json.dumps(event))
    
    try:
        # 1. Trích xuất job_id và question từ event (API Gateway / Test event)
        path_params = event.get("pathParameters") or {}
        job_id = path_params.get("id") or path_params.get("job_id")
        
        body = event.get("body")
        if isinstance(body, str):
            body = json.loads(body) if body else {}
        elif not body:
            body = {}
            
        if not job_id:
            job_id = body.get("job_id")
            
        question = body.get("question") or body.get("query")
        
        if not job_id or not question:
            return {
                "statusCode": 400,
                "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"error_code": "MISSING_PARAMETERS", "message": "Thiếu tham số bắt buộc: job_id hoặc question."})
            }

        # 2. Truy vấn nội dung chunk từ DynamoDB & S3
        try:
            chunks_data = get_chunks_from_job(job_id)
        except LookupError as le:
            return {
                "statusCode": 404,
                "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"error_code": "JOB_NOT_FOUND", "message": str(le)})
            }
        except Exception as ex:
            return {
                "statusCode": 500,
                "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"error_code": "CHUNKS_RETRIEVAL_ERROR", "message": str(ex)})
            }

        # Format chunks thành chuỗi text
        chunks_list = chunks_data.get("chunks", chunks_data.get("segments", []))
        formatted_chunks = "\n".join([
            f"[{c.get('start_time', 0)}s - {c.get('end_time', 0)}s]: {c.get('text', '')}"
            for c in chunks_list
        ])

        # 3. Tạo prompt từ template đã lưu
        prompt_template = load_prompt_template()
        final_prompt = prompt_template.replace("{chunks}", formatted_chunks).replace("{question}", question)
        if "{chunks}" not in prompt_template:
            final_prompt = f"{prompt_template}\n\n[Chunks]:\n{formatted_chunks}\n\n[Question]: {question}"

        # 4. Thực thi gọi Gemini trước, nếu lỗi thì chuyển sang Bedrock
        answer = None
        provider_used = "Gemini"
        gemini_error = None

        try:
            api_key = os.environ.get("GEMINI_API_KEY")
            if not api_key:
                raise ValueError("Thiếu GEMINI_API_KEY cấu hình.")
            
            gemini_client = get_gemini_client(api_key)
            response = gemini_client.models.generate_content(
                model=GEMINI_MODEL,
                contents=final_prompt
            )
            answer = response.text
        except Exception as e:
            gemini_error = str(e)
            logger.warning("Gemini gặp lỗi (%s), tiến hành fallback sang Bedrock...", gemini_error)
            
            try:
                bedrock_svc = BedrockService()
                answer = bedrock_svc.invoke_model(final_prompt)
                provider_used = "Bedrock"
            except Exception as bedrock_err:
                logger.exception("Cả Gemini và Bedrock fallback đều thất bại.")
                return {
                    "statusCode": 502,
                    "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                    "body": json.dumps({
                        "error_code": "AI_SERVICE_UNAVAILABLE",
                        "message": "Không thể xử lý câu hỏi do lỗi từ cả Gemini và Bedrock.",
                        "details": {"gemini_error": gemini_error, "bedrock_error": str(bedrock_err)}
                    })
                }
                
        # 5. Trả kết quả thành công
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps({
                "job_id": job_id,
                "question": question,
                "answer": answer,
                "provider": provider_used,
                "status": "SUCCESS"
            }, ensure_ascii=False)
        }

    except Exception as err:
        logger.exception("Lỗi không xác định trong lambda_handler.")
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps({"error_code": "INTERNAL_SERVER_ERROR", "message": str(err)})
        }
