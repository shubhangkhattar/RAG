"""
RerankNode — cross-encoder reranking using Claude.

The retrieval step uses bi-encoders (query and document embedded separately)
which are fast but miss fine-grained query-document interactions. A cross-
encoder sees the query and each document together, producing a more accurate
relevance score at the cost of speed. Running this on RETRIEVAL_K=20 candidates
(not the full index) keeps latency acceptable.

Claude is prompted to score each chunk 1-10 and return the ranked indices.
This avoids shipping a local ML model in the container image.
"""
import json
import os

from src.clients.bedrock import invoke_claude
from src.graph.state import RagState, Chunk

RERANK_TOP_N = int(os.environ.get("RERANK_TOP_N", "5"))  # chunks sent to generation

_SYSTEM = """\
You are a relevance scoring assistant. You will be given a query and a list of
text passages. Score each passage's relevance to the query from 1 (not relevant)
to 10 (highly relevant).

Output ONLY a JSON array of objects with keys "index" (0-based integer) and
"score" (integer 1-10), sorted by score descending.
Example: [{"index": 2, "score": 9}, {"index": 0, "score": 6}, ...]
No explanation. No other text.
"""


def rerank_node(state: RagState) -> dict:
    chunks = state["retrieved_chunks"]
    query = state["rewritten_query"]

    if not chunks:
        return {"reranked_chunks": []}

    # Build a compact numbered passage list to keep the prompt short
    passages = "\n\n".join(
        f"[{i}] {chunk['text'][:400]}" for i, chunk in enumerate(chunks)
    )
    messages = [
        {
            "role": "user",
            "content": f"Query: {query}\n\nPassages:\n{passages}\n\nScore and rank the passages.",
        }
    ]

    raw = invoke_claude(messages, system=_SYSTEM, max_tokens=512, temperature=0.0)

    try:
        ranked: list[dict] = json.loads(raw.strip())
        # Keep only valid indices
        ranked = [r for r in ranked if isinstance(r.get("index"), int) and 0 <= r["index"] < len(chunks)]
        top_indices = [r["index"] for r in ranked[:RERANK_TOP_N]]
    except (json.JSONDecodeError, TypeError):
        # Fallback: use original RRF order
        top_indices = list(range(min(RERANK_TOP_N, len(chunks))))

    reranked = [chunks[i] for i in top_indices]
    return {"reranked_chunks": reranked}
