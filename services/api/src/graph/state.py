"""
LangGraph state — the single object that flows through every pipeline node.

Each node receives the full state and returns a dict containing only the
fields it writes. LangGraph merges those updates back into the state.
"""
from typing import Optional
from typing_extensions import TypedDict


class Message(TypedDict):
    role: str     # "user" | "assistant"
    content: str


class Chunk(TypedDict):
    chunk_id: str
    document_id: str
    namespace: str
    text: str
    source_key: str
    page_number: int
    section_heading: str
    score: float


class Citation(TypedDict):
    chunk_id: str
    source_key: str
    page_number: int
    section_heading: str
    text_excerpt: str   # first 200 chars of the chunk text


class RagState(TypedDict):
    # ── Set at request entry ─────────────────────────────────────────────────
    session_id: str
    user_id: str
    namespace: str
    user_roles: list[str]
    raw_query: str

    # ── SessionNode ──────────────────────────────────────────────────────────
    conversation_history: list[Message]

    # ── CacheNode ────────────────────────────────────────────────────────────
    cache_hit: bool
    cached_answer: Optional[str]
    cached_citations: Optional[list[Citation]]

    # ── QueryRewriteNode ─────────────────────────────────────────────────────
    rewritten_query: str

    # ── RouterNode ───────────────────────────────────────────────────────────
    target_indices: list[str]

    # ── RetrievalNode ────────────────────────────────────────────────────────
    retrieved_chunks: list[Chunk]

    # ── RerankNode ───────────────────────────────────────────────────────────
    reranked_chunks: list[Chunk]

    # ── GenerationNode ───────────────────────────────────────────────────────
    answer: str
    citations: list[Citation]
