"""
SessionNode — loads conversation history from DynamoDB.

Applies a sliding window cap so the history fed to downstream nodes
never exceeds MAX_TURNS turns, preventing context window overflow.
"""
import os
from src.graph.state import RagState, Message
from src.session.dynamodb_session import load_session

MAX_TURNS = int(os.environ.get("SESSION_MAX_TURNS", "6"))  # 3 user + 3 assistant


def session_node(state: RagState) -> dict:
    history = load_session(state["session_id"])

    # Keep only the most recent MAX_TURNS messages (pairs, so always even)
    if len(history) > MAX_TURNS:
        history = history[-MAX_TURNS:]

    return {"conversation_history": history}
