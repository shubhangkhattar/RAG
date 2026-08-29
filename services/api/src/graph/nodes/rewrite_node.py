"""
QueryRewriteNode — makes ambiguous follow-up questions self-contained.

If the conversation has no prior history, the raw query passes through
unchanged. Otherwise, Claude rewrites it into a standalone question that
a search engine could answer without seeing the conversation context.

Example:
  History:  User: "Tell me about the parental leave policy."
            Assistant: "The policy provides 16 weeks..."
  Follow-up: "What about adoption?"
  Rewritten: "What is the parental leave policy for adoption cases?"
"""
from src.clients.bedrock import invoke_claude
from src.graph.state import RagState

_SYSTEM = """\
You are a query rewriting assistant. Your only job is to rewrite a user's
follow-up question into a fully self-contained question using the conversation
history as context. The rewritten question must be answerable by a search
engine with no access to the conversation.

Rules:
- Output ONLY the rewritten question. No explanation, no preamble.
- If the question is already self-contained, return it verbatim.
- Never answer the question. Never add caveats.
"""


def rewrite_node(state: RagState) -> dict:
    history = state.get("conversation_history", [])
    query = state["raw_query"]

    if not history:
        return {"rewritten_query": query}

    history_text = "\n".join(
        f"{msg['role'].capitalize()}: {msg['content']}" for msg in history
    )
    messages = [
        {
            "role": "user",
            "content": (
                f"Conversation history:\n{history_text}\n\n"
                f"Follow-up question: {query}\n\n"
                "Rewrite the follow-up question to be fully self-contained."
            ),
        }
    ]

    rewritten = invoke_claude(messages, system=_SYSTEM, max_tokens=256, temperature=0.0)
    return {"rewritten_query": rewritten.strip()}
