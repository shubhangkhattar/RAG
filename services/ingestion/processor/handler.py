"""
Document processor Lambda.

Responsibilities:
  1. Download the raw document from S3.
  2. Extract text + structure via Amazon Textract (async for PDFs > 1 page,
     synchronous AnalyzeDocument for images/single-page docs).
  3. Split into hierarchical chunks preserving heading/section context.
  4. Tag each chunk with rich metadata (source, namespace, permissions, page).
  5. Write chunk JSON objects to the processed-docs S3 bucket for the embedder.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import dataclass, asdict
from typing import Any

import boto3

s3 = boto3.client('s3')
textract = boto3.client('textract')

RAW_BUCKET = os.environ['RAW_BUCKET']
PROCESSED_BUCKET = os.environ['PROCESSED_BUCKET']
STAGE = os.environ.get('STAGE', 'dev')

CHUNK_SIZE = 512       # target tokens per chunk (rough char proxy: 1 token ≈ 4 chars)
CHUNK_OVERLAP = 64     # overlap to preserve cross-chunk context


@dataclass
class Chunk:
    chunk_id: str
    document_id: str
    namespace: str
    source_key: str
    page_number: int
    section_heading: str
    text: str
    char_count: int
    metadata: dict[str, Any]


def handler(event: dict, context) -> dict:
    bucket: str = event['bucket']
    key: str = event['key']
    namespace: str = event['namespace']
    stage: str = event.get('stage', STAGE)

    document_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f's3://{bucket}/{key}'))

    raw_text_blocks = _extract_text(bucket, key)
    chunks = _chunk_blocks(raw_text_blocks, document_id, key, namespace)

    out_key = f'chunks/{namespace}/{document_id}.jsonl'
    _write_chunks(chunks, out_key)

    return {
        'bucket': bucket,
        'source_key': key,
        'processed_key': out_key,
        'document_id': document_id,
        'namespace': namespace,
        'chunk_count': len(chunks),
        'stage': stage,
    }


def _extract_text(bucket: str, key: str) -> list[dict]:
    """Return Textract Block objects for the document."""
    ext = key.rsplit('.', 1)[-1].lower()

    if ext in ('jpg', 'jpeg', 'png'):
        resp = textract.analyze_document(
            Document={'S3Object': {'Bucket': bucket, 'Name': key}},
            FeatureTypes=['TABLES', 'FORMS'],
        )
        return resp['Blocks']

    # Async path for PDFs and multi-page docs
    job_id = textract.start_document_analysis(
        DocumentLocation={'S3Object': {'Bucket': bucket, 'Name': key}},
        FeatureTypes=['TABLES', 'FORMS'],
    )['JobId']

    return _poll_textract(job_id)


def _poll_textract(job_id: str) -> list[dict]:
    blocks: list[dict] = []
    next_token: str | None = None

    while True:
        kwargs: dict[str, Any] = {'JobId': job_id}
        if next_token:
            kwargs['NextToken'] = next_token

        resp = textract.get_document_analysis(**kwargs)
        status = resp['JobStatus']

        if status == 'FAILED':
            raise RuntimeError(f'Textract job {job_id} failed: {resp.get("StatusMessage")}')
        if status == 'IN_PROGRESS':
            time.sleep(5)
            continue

        blocks.extend(resp.get('Blocks', []))
        next_token = resp.get('NextToken')
        if not next_token:
            break

    return blocks


def _chunk_blocks(blocks: list[dict], document_id: str, source_key: str, namespace: str) -> list[Chunk]:
    """
    Walk Textract LINE/WORD blocks in reading order, grouping by page and
    detected section headings (Textract marks these as LAYOUT_SECTION_HEADER in newer models;
    fall back to heuristic caps detection here for broad compatibility).
    """
    chunks: list[Chunk] = []
    page_lines: dict[int, list[str]] = {}
    page_headings: dict[int, str] = {}

    for block in blocks:
        if block['BlockType'] not in ('LINE',):
            continue
        page = block.get('Page', 1)
        text = block.get('Text', '').strip()
        if not text:
            continue

        if _is_heading(text):
            page_headings[page] = text
        else:
            page_lines.setdefault(page, []).append(text)

    for page, lines in sorted(page_lines.items()):
        combined = ' '.join(lines)
        heading = page_headings.get(page, '')

        for i, window in enumerate(_sliding_window(combined, CHUNK_SIZE, CHUNK_OVERLAP)):
            chunks.append(Chunk(
                chunk_id=str(uuid.uuid4()),
                document_id=document_id,
                namespace=namespace,
                source_key=source_key,
                page_number=page,
                section_heading=heading,
                text=window,
                char_count=len(window),
                metadata={
                    'namespace': namespace,
                    'source': source_key,
                    'page': page,
                    'section': heading,
                    'chunk_index': i,
                },
            ))

    return chunks


def _is_heading(text: str) -> bool:
    words = text.split()
    return len(words) <= 8 and text == text.upper() and len(text) > 3


def _sliding_window(text: str, size: int, overlap: int):
    """Yield character-level sliding windows. Real implementation should use token counts."""
    start = 0
    while start < len(text):
        yield text[start:start + size]
        start += size - overlap
        if start + overlap >= len(text):
            break


def _write_chunks(chunks: list[Chunk], out_key: str) -> None:
    lines = '\n'.join(json.dumps(asdict(c)) for c in chunks)
    s3.put_object(
        Bucket=PROCESSED_BUCKET,
        Key=out_key,
        Body=lines.encode(),
        ContentType='application/jsonl',
    )
