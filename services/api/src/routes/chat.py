"""
POST /v1/chat — main RAG endpoint.

Extracts user identity from the Cognito JWT that API Gateway already validated.
Builds the initial LangGraph state and runs the pipeline.
"""
import base64
import json

from fastapi import APIRouter, Depends, HTTPException, Request

from src.graph.rag_graph import rag_pipeline
from src.graph.state import RagState
from src.models.chat import ChatRequest, ChatResponse, CitationOut
from src.session.dynamodb_session import new_session_id

router = APIRouter(prefix="/v1", tags=["chat"])


def _claims(request: Request) -> dict:
    """
    Decode the Cognito JWT from the Authorization header.

    API Gateway has already verified the signature and expiry before the request
    reached the VPC, so we only need to decode (not re-verify) to extract claims.
    This keeps the service stateless and avoids a Cognito JWK fetch on every call.
    """
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = auth.removeprefix("Bearer ")
    try:
        # JWT = header.payload.signature — we only need the payload
        payload_b64 = token.split(".")[1]
        # Add padding that JWT strips
        padded = payload_b64 + "=" * (4 - len(payload_b64) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        raise HTTPException(status_code=401, detail="Malformed token")

    return claims


@router.post("/chat", response_model=ChatResponse)
def chat(body: ChatRequest, claims: dict = Depends(_claims)):
    user_id: str = claims.get("sub", "unknown")
    # custom:namespace is the Cognito custom attribute set by the admin
    namespace: str = claims.get("custom:namespace", "general")
    roles: list[str] = claims.get("custom:roles", "").split(",")

    session_id = body.session_id or new_session_id()

    initial_state: RagState = {
        "session_id": session_id,
        "user_id": user_id,
        "namespace": namespace,
        "user_roles": [r.strip() for r in roles if r.strip()],
        "raw_query": body.query,
        # Remaining fields are populated by the graph nodes
        "conversation_history": [],
        "cache_hit": False,
        "cached_answer": None,
        "cached_citations": None,
        "rewritten_query": "",
        "target_indices": [],
        "retrieved_chunks": [],
        "reranked_chunks": [],
        "answer": "",
        "citations": [],
    }

    final_state: RagState = rag_pipeline.invoke(initial_state)

    if final_state["cache_hit"]:
        answer = final_state["cached_answer"] or ""
        citations = [CitationOut(**c) for c in (final_state["cached_citations"] or [])]
        rewritten = body.query
    else:
        answer = final_state["answer"]
        citations = [CitationOut(**c) for c in final_state["citations"]]
        rewritten = final_state["rewritten_query"]

    return ChatResponse(
        session_id=session_id,
        answer=answer,
        citations=citations,
        rewritten_query=rewritten,
        cache_hit=final_state["cache_hit"],
    )
