"""
GenerationNode — grounded answer generation with mandatory citations.

Claude is given only the reranked chunks as its knowledge source. The system
prompt prohibits answering from training data and requires every claim to be
backed by a citation. If the chunks don't contain a sufficient answer, Claude
must say so rather than hallucinate.

The response is structured JSON so citations are machine-parseable, not just
inline footnotes.
"""
import json

from src.clients.bedrock import invoke_claude
from src.graph.state import RagState, Chunk, Citation

_SYSTEM = """\
You are an enterprise knowledge assistant. Answer the user's question using
ONLY the provided context passages. Do not use any knowledge from your training
data.

Rules:
1. Every factual claim must reference the passage(s) it came from using the
   chunk_id provided.
2. If the context does not contain enough information to answer, respond with
   {"answer": "I don't have enough information in the available documents to
   answer this question.", "citations": []}
3. Be concise and direct. No preamble.

Output ONLY valid JSON matching this schema:
{
  "answer": "<your answer here>",
  "citations": [
    {
      "chunk_id": "<id>",
      "source_key": "<s3 key>",
      "page_number": <int>,
      "section_heading": "<heading>",
      "text_excerpt": "<first 200 chars of the chunk>"
    }
  ]
}
"""


def generation_node(state: RagState) -> dict:
    chunks = state["reranked_chunks"]
    query = state["rewritten_query"]
    history = state.get("conversation_history", [])

    context = _format_context(chunks)
    conversation = _format_history(history)

    user_content = (
        f"{conversation}"
        f"Context passages:\n{context}\n\n"
        f"Question: {query}"
    )

    messages = [{"role": "user", "content": user_content}]
    raw = invoke_claude(messages, system=_SYSTEM, max_tokens=2048, temperature=0.0)

    try:
        parsed = json.loads(raw.strip())
        answer: str = parsed.get("answer", "")
        raw_citations: list[dict] = parsed.get("citations", [])
    except (json.JSONDecodeError, TypeError):
        # If Claude didn't return valid JSON, surface the raw text with no citations
        answer = raw.strip()
        raw_citations = []

    # Enrich citations with text_excerpt from the actual chunks
    chunk_map = {c["chunk_id"]: c for c in chunks}
    citations: list[Citation] = []
    for cite in raw_citations:
        cid = cite.get("chunk_id", "")
        chunk = chunk_map.get(cid)
        citations.append(Citation(
            chunk_id=cid,
            source_key=cite.get("source_key", chunk["source_key"] if chunk else ""),
            page_number=cite.get("page_number", chunk["page_number"] if chunk else 0),
            section_heading=cite.get("section_heading", chunk["section_heading"] if chunk else ""),
            text_excerpt=(chunk["text"][:200] if chunk else ""),
        ))

    return {"answer": answer, "citations": citations}


def _format_context(chunks: list[Chunk]) -> str:
    parts = []
    for chunk in chunks:
        parts.append(
            f"[chunk_id={chunk['chunk_id']} source={chunk['source_key']} "
            f"page={chunk['page_number']} section={chunk['section_heading']!r}]\n"
            f"{chunk['text']}"
        )
    return "\n\n---\n\n".join(parts)


def _format_history(history: list[dict]) -> str:
    if not history:
        return ""
    lines = "\n".join(f"{m['role'].capitalize()}: {m['content']}" for m in history)
    return f"Previous conversation:\n{lines}\n\n"
