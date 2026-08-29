"""
Session management endpoints.

GET  /v1/sessions          — list the caller's active sessions
DELETE /v1/sessions/{id}   — delete a session
"""
import base64
import json

from fastapi import APIRouter, Depends, HTTPException, Request

from src.models.chat import SessionSummary
from src.session.dynamodb_session import delete_session, list_sessions

router = APIRouter(prefix="/v1", tags=["sessions"])


def _user_id(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = auth.removeprefix("Bearer ")
    try:
        payload_b64 = token.split(".")[1]
        padded = payload_b64 + "=" * (4 - len(payload_b64) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded))
        return claims["sub"]
    except Exception:
        raise HTTPException(status_code=401, detail="Malformed token")


@router.get("/sessions", response_model=list[SessionSummary])
def get_sessions(user_id: str = Depends(_user_id)):
    items = list_sessions(user_id)
    return [
        SessionSummary(
            session_id=item["session_id"],
            created_at=item["created_at"],
            message_count=int(item.get("message_count", 0)),
        )
        for item in items
    ]


@router.delete("/sessions/{session_id}", status_code=204)
def remove_session(session_id: str, user_id: str = Depends(_user_id)):
    delete_session(session_id)
