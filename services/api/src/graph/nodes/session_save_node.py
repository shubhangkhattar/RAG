"""
SessionSaveNode — persists the completed turn and populates the cache.

This is the last node before END. It:
  1. Appends the (rewritten query, answer) turn to DynamoDB.
  2. Updates the semantic cache entry with the real answer so future
     similar queries get a cache hit.
"""
from src.graph.nodes.cache_node import write_to_cache
from src.graph.state import RagState
from src.session.dynamodb_session import save_turn


def session_save_node(state: RagState) -> dict:
    save_turn(
        session_id=state["session_id"],
        user_id=state["user_id"],
        user_message=state["rewritten_query"],
        assistant_message=state["answer"],
    )

    write_to_cache(
        namespace=state["namespace"],
        query=state["rewritten_query"],
        answer=state["answer"],
        citations=state["citations"],
    )

    return {}
