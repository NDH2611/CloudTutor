import json
import logging
import os
from typing import Dict, Any
import boto3
from botocore.exceptions import ClientError
from geminiService import get_gemini_client

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def load_prompt() -> str:
    prompt_path = os.path.join(os.path.dirname(__file__), "prompts", "prompt.txt")
    with open(prompt_path, "r", encoding="utf-8") as f:
        return f.read()

def _clean_json_response(response_text: str) -> Dict[str, Any]:
    cleaned_text = response_text.strip()
    if cleaned_text.startswith("```json"):
        cleaned_text = cleaned_text[7:]
    if cleaned_text.endswith("```"):
        cleaned_text = cleaned_text[:-3]
    cleaned_text = cleaned_text.strip()
    return json.loads(cleaned_text)

def _call_bedrock(full_prompt: str, region_name: str, model_id: str) -> Dict[str, Any]:
    logger.info("Using Amazon Bedrock (model: %s) to generate Summary and Quiz...", model_id)
    client = boto3.client("bedrock-runtime", region_name=region_name)
    
    response = client.converse(
        modelId=model_id,
        messages=[
            {
                "role": "user",
                "content": [{"text": full_prompt}]
            }
        ],
        inferenceConfig={
            "maxTokens": 4096,
            "temperature": 0.3
        }
    )
    
    output_message = response.get("output", {}).get("message", {})
    content_blocks = output_message.get("content", [])
    text_parts = [block["text"] for block in content_blocks if "text" in block]

    if not text_parts:
        raise ValueError("Bedrock Converse API return blank result.")

    response_text = "\n".join(text_parts)
    return _clean_json_response(response_text)

def _call_gemini(full_prompt: str, model_name: str) -> Dict[str, Any]:
    logger.info("Using Google AI (Gemini, model: %s) as fallback...", model_name)
    api_key = os.environ.get("GEMINI_API_KEY")
    client = get_gemini_client(api_key)
    
    response = client.models.generate_content(
        model=model_name,
        contents=full_prompt,
    )
    return _clean_json_response(response.text)

def generate_study_content(
    chunk_data: Dict[str, Any], 
    bedrock_model_id: str = "apac.amazon.nova-lite-v1:0",
    bedrock_region: str = "ap-southeast-1",
    gemini_model_name: str = "gemini-3.6-flash"
) -> Dict[str, Any]:

    job_id = chunk_data.get("job_id", "")
    owner_id = chunk_data.get("owner_id", "")
    transcription_job_name = chunk_data.get("transcription_job_name", "")
    
    try:
        template = load_prompt()
    except Exception as e:
        logger.error(f"Can't load prompt.txt: {e}")
        raise e
        
    prompt = (
        template
        .replace("{job_id}", job_id)
        .replace("{owner_id}", owner_id)
        .replace("{transcription_job_name}", transcription_job_name)
    )
    
    # 2. Ghép dữ liệu chunks
    chunks_text = "\n\n".join([
        f"[{c.get('chunk_id', '')}] ({c.get('start_time', 0.0)}s - {c.get('end_time', 0.0)}s): {c.get('text', '')}" 
        for c in chunk_data.get("chunks", [])
    ])
    full_prompt = f"{prompt}\n\nTranscript Chunks:\n{chunks_text}"
    
    result_json = None
    
    # 3. Ưu tiên gọi Bedrock trước
    try:
        result_json = _call_bedrock(full_prompt, region_name=bedrock_region, model_id=bedrock_model_id)
        logger.info("Generate Summary and Quiz by Amazon Bedrock succeed.")
        return result_json
        
    except (ClientError, Exception) as e:  # <-- Đã sửa lỗi cú pháp ở đây
        logger.warning(f"Generate Summary and Quiz by Amazon Bedrock failed ({e}). Changed to fallback Gemini...")
        
        # 4. Fallback sang Gemini nếu Bedrock gặp lỗi
        try:
            result_json = _call_gemini(full_prompt, model_name=gemini_model_name)
            logger.info("Generate Summary and Quiz by Gemini Fallback succeed.")
            return result_json
            
        except json.JSONDecodeError as json_err:
            logger.error(f"Error parse JSON from Gemini fallback: {json_err}")
            raise json_err
        except Exception as gemini_err:
            logger.error(f"Both Bedrock and Gemini failed. Gemini failed: {gemini_err}")
            raise gemini_err
