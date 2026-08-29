"""
RouterNode — classifies the query and selects which OpenSearch indices to search.

Uses Claude to map the rewritten query to one or more namespaces. The response
is constrained to a JSON list of index names so parsing is reliable.

Index naming follows the convention established in the embedder:
  rag-<namespace>-<stage>   e.g. rag-hr-dev, rag-it-dev, rag-finance-dev

The user's own namespace (from their Cognito claim) is always included as a
candidate. This prevents a routing bug from silently dropping the primary index.
"""
import json
import os

from src.clients.bedrock import invoke_claude
from src.graph.state import RagState

STAGE = os.environ.get("STAGE", "dev")

# Authoritative list of namespaces. In production this could be loaded from
# a config store (SSM Parameter Store) rather than hardcoded.
AVAILABLE_NAMESPACES: list[str] = os.environ.get(
    "AVAILABLE_NAMESPACES", "hr,it,finance,legal,general"
).split(",")

_SYSTEM = f"""\
You are a query routing assistant. Given a user question, identify which
knowledge domains (namespaces) it relates to from this list:
{", ".join(AVAILABLE_NAMESPACES)}

Output ONLY a JSON array of matching namespace names, lowercase, no explanation.
Example output: ["hr", "finance"]
If unsure, include "general". Never output an empty array.
"""


def router_node(state: RagState) -> dict:
    query = state["rewritten_query"]
    user_namespace = state["namespace"]

    messages = [{"role": "user", "content": f"Route this query: {query}"}]
    raw = invoke_claude(messages, system=_SYSTEM, max_tokens=128, temperature=0.0)

    try:
        namespaces: list[str] = json.loads(raw.strip())
        # Validate — only keep known namespaces
        namespaces = [n for n in namespaces if n in AVAILABLE_NAMESPACES]
    except (json.JSONDecodeError, TypeError):
        namespaces = []

    # Always search the user's own namespace even if routing missed it
    if user_namespace not in namespaces:
        namespaces.append(user_namespace)

    # Convert to index names
    indices = [f"rag-{ns}-{STAGE}" for ns in namespaces]
    return {"target_indices": indices}
