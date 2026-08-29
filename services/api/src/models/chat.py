from typing import Optional
from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=4096)
    session_id: Optional[str] = Field(
        default=None,
        description="Omit to start a new session; pass to continue an existing one.",
    )


class CitationOut(BaseModel):
    chunk_id: str
    source_key: str
    page_number: int
    section_heading: str
    text_excerpt: str


class ChatResponse(BaseModel):
    session_id: str
    answer: str
    citations: list[CitationOut]
    rewritten_query: str
    cache_hit: bool


class SessionSummary(BaseModel):
    session_id: str
    created_at: str
    message_count: int
