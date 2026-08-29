"""
RetrievalNode — hybrid search across all routed OpenSearch indices.

For each target index:
  1. Dense kNN search using Titan Embeddings v2 vector.
  2. BM25 keyword search on the text field.
  3. Reciprocal Rank Fusion (RRF) to merge the two ranked lists.

Results across multiple indices are pooled and re-sorted by fused score.
A namespace metadata filter is applied on every query — this is the hard
RBAC wall. Even if routing sends the query to the wrong index, the filter
ensures users only see chunks whose namespace matches their Cognito claim.
"""
import os

from src.clients.bedrock import embed_text
from src.clients.opensearch import get_opensearch
from src.graph.state import RagState, Chunk

RETRIEVAL_K = int(os.environ.get("RETRIEVAL_K", "20"))   # candidates per search type
FINAL_K = int(os.environ.get("RETRIEVAL_FINAL_K", "20")) # total after RRF
RRF_K = 60  # RRF constant — larger values reduce the impact of high ranks


def retrieval_node(state: RagState) -> dict:
    query = state["rewritten_query"]
    indices = state["target_indices"]
    namespace = state["namespace"]

    query_vec = embed_text(query)
    client = get_opensearch()

    all_chunks: list[Chunk] = []

    for index in indices:
        try:
            chunks = _hybrid_search(client, index, query, query_vec, namespace)
            all_chunks.extend(chunks)
        except Exception:
            # Index may not exist yet (no documents ingested for that namespace)
            continue

    # Sort by fused score descending, deduplicate by chunk_id
    seen: set[str] = set()
    unique: list[Chunk] = []
    for chunk in sorted(all_chunks, key=lambda c: c["score"], reverse=True):
        if chunk["chunk_id"] not in seen:
            seen.add(chunk["chunk_id"])
            unique.append(chunk)

    return {"retrieved_chunks": unique[:FINAL_K]}


def _hybrid_search(client, index: str, query: str, query_vec: list[float], namespace: str) -> list[Chunk]:
    namespace_filter = {"term": {"namespace": namespace}}

    # ── Dense kNN search ─────────────────────────────────────────────────────
    knn_resp = client.search(index=index, body={
        "size": RETRIEVAL_K,
        "_source": {"excludes": ["embedding"]},
        "query": {
            "bool": {
                "filter": [namespace_filter],
                "must": [{"knn": {"embedding": {"vector": query_vec, "k": RETRIEVAL_K}}}],
            }
        },
    })
    knn_hits = knn_resp["hits"]["hits"]

    # ── BM25 keyword search ───────────────────────────────────────────────────
    bm25_resp = client.search(index=index, body={
        "size": RETRIEVAL_K,
        "_source": {"excludes": ["embedding"]},
        "query": {
            "bool": {
                "filter": [namespace_filter],
                "must": [{"match": {"text": {"query": query, "operator": "or"}}}],
            }
        },
    })
    bm25_hits = bm25_resp["hits"]["hits"]

    # ── Reciprocal Rank Fusion ────────────────────────────────────────────────
    return _rrf(knn_hits, bm25_hits)


def _rrf(knn_hits: list[dict], bm25_hits: list[dict]) -> list[Chunk]:
    scores: dict[str, float] = {}
    sources: dict[str, dict] = {}

    for rank, hit in enumerate(knn_hits):
        cid = hit["_source"]["chunk_id"]
        scores[cid] = scores.get(cid, 0.0) + 1.0 / (RRF_K + rank + 1)
        sources[cid] = hit["_source"]

    for rank, hit in enumerate(bm25_hits):
        cid = hit["_source"]["chunk_id"]
        scores[cid] = scores.get(cid, 0.0) + 1.0 / (RRF_K + rank + 1)
        sources[cid] = hit["_source"]

    return [
        Chunk(
            chunk_id=cid,
            document_id=src.get("document_id", ""),
            namespace=src.get("namespace", ""),
            text=src.get("text", ""),
            source_key=src.get("source_key", ""),
            page_number=src.get("page_number", 0),
            section_heading=src.get("section_heading", ""),
            score=scores[cid],
        )
        for cid, src in sources.items()
    ]
