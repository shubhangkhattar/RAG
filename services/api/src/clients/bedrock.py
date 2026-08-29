"""
Shared Bedrock runtime client.

Singleton pattern — one client per Lambda/container lifecycle.
All Bedrock calls go through invoke_claude() and embed_text() so
model IDs and request shapes are kept in one place.
"""
import json
import os
import boto3

_client = None

GENERATION_MODEL = os.environ.get(
    "GENERATION_MODEL_ID",
    "anthropic.claude-3-sonnet-20240229-v1:0",
)
EMBEDDING_MODEL = os.environ.get(
    "EMBEDDING_MODEL_ID",
    "amazon.titan-embed-text-v2:0",
)
EMBEDDING_DIM = 1024


def _bedrock():
    global _client
    if _client is None:
        _client = boto3.client(
            "bedrock-runtime",
            region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
        )
    return _client


def invoke_claude(
    messages: list[dict],
    system: str = "",
    max_tokens: int = 1024,
    temperature: float = 0.0,
) -> str:
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": messages,
    }
    if system:
        body["system"] = system

    resp = _bedrock().invoke_model(
        modelId=GENERATION_MODEL,
        body=json.dumps(body),
        contentType="application/json",
        accept="application/json",
    )
    result = json.loads(resp["body"].read())
    return result["content"][0]["text"]


def embed_text(text: str) -> list[float]:
    resp = _bedrock().invoke_model(
        modelId=EMBEDDING_MODEL,
        body=json.dumps({"inputText": text, "dimensions": EMBEDDING_DIM, "normalize": True}),
        contentType="application/json",
        accept="application/json",
    )
    return json.loads(resp["body"].read())["embedding"]
