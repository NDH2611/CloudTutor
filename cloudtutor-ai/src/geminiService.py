import os
from google import genai

def get_gemini_client(api_key: str):
    client = genai.Client(api_key=api_key)
    return client
