"""
Embedder Lambda.

Responsibilities:
  1. Read the chunk JSONL written by the processor from S3.
  2. Generate dense vector embeddings via Bedrock Titan Embeddings v2.
  3. Upsert each chunk + embedding into the correct OpenSearch index.

Index naming convention: rag-<namespace>-<stage>
This enforces strict namespace isolation — the API enforces that users
can only query indices matching their Cognito `namespace` claim.
"""
from __future__ import annotations

import json
import os
from typing import Any

import boto3
from opensearchpy import OpenSearch, RequestsHttpConnection, AWSV4SignerAuth

OPENSEARCH_ENDPOINT = os.environ['OPENSEARCH_ENDPOINT']
PROCESSED_BUCKET = os.environ['PROCESSED_BUCKET']
STAGE = os.environ.get('STAGE', 'dev')
REGION = os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')

EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v2:0'
EMBEDDING_DIM = 1024  # Titan Embeddings v2 output dimension
BATCH_SIZE = 25       # Bedrock Titan: max 25 concurrent calls before throttle

s3 = boto3.client('s3')
bedrock = boto3.client('bedrock-runtime', region_name=REGION)
credentials = boto3.Session().get_credentials()

_os_client: OpenSearch | None = None


def _get_os_client() -> OpenSearch:
    global _os_client
    if _os_client is None:
        auth = AWSV4SignerAuth(credentials, REGION, 'es')
        _os_client = OpenSearch(
            hosts=[{'host': OPENSEARCH_ENDPOINT, 'port': 443}],
            http_auth=auth,
            use_ssl=True,
            verify_certs=True,
            connection_class=RequestsHttpConnection,
        )
    return _os_client


def handler(event: dict, context) -> dict:
    processed_key: str = event['processed_key']
    document_id: str = event['document_id']
    namespace: str = event['namespace']
    chunk_count: int = event['chunk_count']

    chunks = _read_chunks(processed_key)
    index_name = f'rag-{namespace}-{STAGE}'.lower()

    _ensure_index(index_name)

    indexed = 0
    for batch in _batches(chunks, BATCH_SIZE):
        texts = [c['text'] for c in batch]
        embeddings = _embed_batch(texts)
        _bulk_index(index_name, batch, embeddings)
        indexed += len(batch)

    return {
        **event,
        'indexed_count': indexed,
        'index_name': index_name,
    }


def _read_chunks(key: str) -> list[dict]:
    obj = s3.get_object(Bucket=PROCESSED_BUCKET, Key=key)
    lines = obj['Body'].read().decode().strip().split('\n')
    return [json.loads(line) for line in lines if line]


def _embed_batch(texts: list[str]) -> list[list[float]]:
    embeddings = []
    for text in texts:
        resp = bedrock.invoke_model(
            modelId=EMBEDDING_MODEL_ID,
            body=json.dumps({'inputText': text, 'dimensions': EMBEDDING_DIM, 'normalize': True}),
            contentType='application/json',
            accept='application/json',
        )
        body = json.loads(resp['body'].read())
        embeddings.append(body['embedding'])
    return embeddings


def _bulk_index(index: str, chunks: list[dict], embeddings: list[list[float]]) -> None:
    client = _get_os_client()
    actions: list[dict[str, Any]] = []

    for chunk, embedding in zip(chunks, embeddings):
        actions.append({'index': {'_index': index, '_id': chunk['chunk_id']}})
        actions.append({
            'chunk_id': chunk['chunk_id'],
            'document_id': chunk['document_id'],
            'namespace': chunk['namespace'],
            'text': chunk['text'],
            'embedding': embedding,
            'source_key': chunk['source_key'],
            'page_number': chunk['page_number'],
            'section_heading': chunk['section_heading'],
            'char_count': chunk['char_count'],
            'metadata': chunk['metadata'],
        })

    client.bulk(body=actions)


def _ensure_index(index: str) -> None:
    """Create the index with kNN + BM25 mappings if it does not exist."""
    client = _get_os_client()
    if client.indices.exists(index=index):
        return

    client.indices.create(
        index=index,
        body={
            'settings': {
                'index': {
                    'knn': True,
                    'knn.algo_param.ef_search': 512,
                    'number_of_shards': 1,
                    'number_of_replicas': 0,
                },
            },
            'mappings': {
                'properties': {
                    'chunk_id': {'type': 'keyword'},
                    'document_id': {'type': 'keyword'},
                    'namespace': {'type': 'keyword'},
                    # `text` is analysed for BM25 keyword search
                    'text': {'type': 'text', 'analyzer': 'english'},
                    # `embedding` is the dense vector for kNN search
                    'embedding': {
                        'type': 'knn_vector',
                        'dimension': EMBEDDING_DIM,
                        'method': {
                            'name': 'hnsw',
                            'space_type': 'cosinesimil',
                            'engine': 'nmslib',
                            'parameters': {'ef_construction': 512, 'M': 16},
                        },
                    },
                    'source_key': {'type': 'keyword'},
                    'page_number': {'type': 'integer'},
                    'section_heading': {'type': 'text'},
                    'char_count': {'type': 'integer'},
                    'metadata': {'type': 'object', 'dynamic': True},
                }
            },
        },
    )


def _batches(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]
