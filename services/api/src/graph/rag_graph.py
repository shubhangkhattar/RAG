"""
RAG pipeline as a LangGraph StateGraph.

Flow:
                        ┌─────────┐
                        │  cache  │
                        └────┬────┘
               cache hit     │    cache miss
         ┌───────────────────┤
         ▼                   ▼
        END              session
                             │
                           rewrite
                             │
                           router
                             │
                         retrieval
                             │
                           rerank
                             │
                        generation
                             │
                        session_save
                             │
                            END
"""
from langgraph.graph import StateGraph, END

from src.graph.state import RagState
from src.graph.nodes.cache_node import cache_node
from src.graph.nodes.session_node import session_node
from src.graph.nodes.rewrite_node import rewrite_node
from src.graph.nodes.router_node import router_node
from src.graph.nodes.retrieval_node import retrieval_node
from src.graph.nodes.rerank_node import rerank_node
from src.graph.nodes.generation_node import generation_node
from src.graph.nodes.session_save_node import session_save_node


def _route_after_cache(state: RagState) -> str:
    return "end" if state["cache_hit"] else "session"


def build_graph():
    graph = StateGraph(RagState)

    graph.add_node("cache", cache_node)
    graph.add_node("session", session_node)
    graph.add_node("rewrite", rewrite_node)
    graph.add_node("router", router_node)
    graph.add_node("retrieval", retrieval_node)
    graph.add_node("rerank", rerank_node)
    graph.add_node("generation", generation_node)
    graph.add_node("session_save", session_save_node)

    graph.set_entry_point("cache")

    graph.add_conditional_edges(
        "cache",
        _route_after_cache,
        {"end": END, "session": "session"},
    )

    graph.add_edge("session", "rewrite")
    graph.add_edge("rewrite", "router")
    graph.add_edge("router", "retrieval")
    graph.add_edge("retrieval", "rerank")
    graph.add_edge("rerank", "generation")
    graph.add_edge("generation", "session_save")
    graph.add_edge("session_save", END)

    return graph.compile()


# Module-level compiled graph — built once at import time, reused per request
rag_pipeline = build_graph()
