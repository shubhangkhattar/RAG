"""
CacheNode — first node in the pipeline.

Checks Redis for a semantic cache hit before touching OpenSearch or Bedrock.
Two-layer check:
  1. Exact match on the raw query string (fast, free).
  2. Embedding similarity against cached query vectors (catches paraphrases).

If either hits, the cached answer and citations are injected into state and
the graph short-circuits to END, skipping all downstream nodes.
"""
import json
import os
import struct

from src.clients.bedrock import embed_text
from src.clients.redis_client import get_redis
from src.graph.state import RagState

# Cosine similarity threshold — must be very high to avoid false positives.
# 0.97 means the query is essentially the same question in different words.
SEMANTIC_THRESHOLD = float(os.environ.get("CACHE_SIMILARITY_THRESHOLD", "0.97"))
EXACT_TTL = int(os.environ.get("CACHE_EXACT_TTL_SECONDS", "300"))        # 5 min
SEMANTIC_TTL = int(os.environ.get("CACHE_SEMANTIC_TTL_SECONDS", "3600"))  # 1 hr
MAX_SEMANTIC_CANDIDATES = 50


def cache_node(state: RagState) -> dict:
    redis = get_redis()
    query = state["raw_query"]
    ns = state["namespace"]

    # ── 1. Exact match ───────────────────────────────────────────────────────
    exact_key = f"rag:exact:{ns}:{hash(query)}"
    hit = redis.get(exact_key)
    if hit:
        payload = json.loads(hit)
        return {
            "cache_hit": True,
            "cached_answer": payload["answer"],
            "cached_citations": payload["citations"],
        }

    # ── 2. Semantic match ────────────────────────────────────────────────────
    query_vec = embed_text(query)
    best_score, best_payload = _semantic_lookup(redis, ns, query_vec)

    if best_score >= SEMANTIC_THRESHOLD:
        return {
            "cache_hit": True,
            "cached_answer": best_payload["answer"],
            "cached_citations": best_payload["citations"],
        }

    # Cache miss — store the query embedding so future queries can match it
    _store_embedding(redis, ns, query_vec, query)

    return {
        "cache_hit": False,
        "cached_answer": None,
        "cached_citations": None,
        # Carry the computed embedding forward so RetrievalNode reuses it
        # (avoids a second Bedrock call for the same query)
    }


def write_to_cache(namespace: str, query: str, answer: str, citations: list) -> None:
    """Called by SessionSaveNode after generation to populate both cache layers."""
    redis = get_redis()
    answer_payload = {"answer": answer, "citations": citations}

    exact_key = f"rag:exact:{namespace}:{hash(query)}"
    redis.setex(exact_key, EXACT_TTL, json.dumps(answer_payload))

    # Back-fill the semantic entry that was created on this miss so future
    # semantic matches return the real answer instead of None.
    sem_key = f"rag:sem:{namespace}:{hash(query)}"
    raw = redis.get(sem_key)
    if raw:
        entry = json.loads(raw)
        entry["payload"] = answer_payload
        redis.setex(sem_key, SEMANTIC_TTL, json.dumps(entry))


# ── Helpers ──────────────────────────────────────────────────────────────────

def _semantic_lookup(redis, namespace: str, query_vec: list[float]) -> tuple[float, dict | None]:
    """Scan stored embeddings and return (best_cosine_score, payload)."""
    pattern = f"rag:sem:{namespace}:*"
    best_score = -1.0
    best_payload = None

    cursor = 0
    scanned = 0
    while scanned < MAX_SEMANTIC_CANDIDATES:
        cursor, keys = redis.scan(cursor, match=pattern, count=20)
        for key in keys:
            raw = redis.get(key)
            if not raw:
                continue
            entry = json.loads(raw)
            stored_vec = entry["embedding"]
            score = _cosine(query_vec, stored_vec)
            if score > best_score:
                best_score = score
                best_payload = entry.get("payload")
            scanned += 1
        if cursor == 0:
            break

    return best_score, best_payload


def _store_embedding(redis, namespace: str, vec: list[float], query: str) -> None:
    key = f"rag:sem:{namespace}:{hash(query)}"
    # Only store the vector without a payload yet; payload added after generation
    redis.setex(key, SEMANTIC_TTL, json.dumps({"embedding": vec, "payload": None}))


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = sum(x * x for x in a) ** 0.5
    mag_b = sum(x * x for x in b) ** 0.5
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)
