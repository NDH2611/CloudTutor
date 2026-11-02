import logging
import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

class BedrockService:
    def __init__(
        self,
        region_name: str = "ap-southeast-1",
        model_id: str = "apac.amazon.nova-lite-v1:0"
    ):
        self.region_name = region_name
        self.model_id = model_id
        self.client = boto3.client(
            "bedrock-runtime",
            region_name=self.region_name
        )

    def invoke_model(self, prompt: str) -> str:
        logger.info("Invoking Bedrock model (Converse API): %s", self.model_id)

        try:
            response = self.client.converse(
                modelId=self.model_id,
                messages=[
                    {
                        "role": "user",
                        "content": [{"text": prompt}]
                    }
                ],
                inferenceConfig={
                    "maxTokens": 4096,
                    "temperature": 0.2
                }
            )
            output_message = response.get("output", {}).get("message", {})
            content_blocks = output_message.get("content", [])
            
            text_parts = [
                block["text"] for block in content_blocks if "text" in block
            ]

            if not text_parts:
                raise ValueError("Bedrock Converse API returned no text content.")

            return "\n".join(text_parts)

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            logger.exception("Bedrock invocation failed with code: %s", error_code)
            raise
