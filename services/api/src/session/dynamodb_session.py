"""
DynamoDB session manager.

Schema:
  PK  session_id  (String)
  SK  created_at  (String, ISO-8601) — enables range queries for session listing
  Attributes:
    user_id       String
    messages      List  — [{role, content}, ...]
    message_count Number
    ttl           Number — epoch seconds, DynamoDB auto-deletes after expiry
    namespace     String

A session is a single DynamoDB item. The messages list is updated on every
turn via an UpdateItem expression to avoid reading the item first.
Sessions expire automatically via DynamoDB TTL (no cron job required).
"""
import json
import os
import time
import uuid
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key

_table = None

SESSION_TTL_SECONDS = int(os.environ.get("SESSION_TTL_SECONDS", str(24 * 3600)))  # 24 h


def _get_table():
    global _table
    if _table is None:
        _table = boto3.resource(
            "dynamodb",
            region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
        ).Table(os.environ["SESSIONS_TABLE"])
    return _table


def new_session_id() -> str:
    return str(uuid.uuid4())


def load_session(session_id: str) -> list[dict]:
    """Return the messages list for this session, or [] if it doesn't exist."""
    resp = _get_table().get_item(
        Key={"session_id": session_id, "created_at": _session_created_at(session_id)},
        ProjectionExpression="messages",
    )
    item = resp.get("Item")
    if not item:
        return []
    return item.get("messages", [])


def save_turn(session_id: str, user_id: str, user_message: str, assistant_message: str) -> None:
    """Append a user+assistant turn to the session, creating the item if needed."""
    table = _get_table()
    now = datetime.now(timezone.utc).isoformat()
    new_ttl = int(time.time()) + SESSION_TTL_SECONDS

    new_messages = [
        {"role": "user", "content": user_message},
        {"role": "assistant", "content": assistant_message},
    ]

    try:
        # Try to append to existing session
        table.update_item(
            Key={"session_id": session_id, "created_at": _session_created_at(session_id)},
            UpdateExpression=(
                "SET messages = list_append(messages, :new_msgs), "
                "message_count = message_count + :inc, "
                "#ttl = :ttl"
            ),
            ExpressionAttributeNames={"#ttl": "ttl"},
            ExpressionAttributeValues={
                ":new_msgs": new_messages,
                ":inc": 2,
                ":ttl": new_ttl,
            },
            ConditionExpression="attribute_exists(session_id)",
        )
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        # Session doesn't exist yet — create it
        table.put_item(Item={
            "session_id": session_id,
            "created_at": now,
            "user_id": user_id,
            "messages": new_messages,
            "message_count": 2,
            "ttl": new_ttl,
        })
        # Cache the created_at so future calls can look it up
        _store_created_at(session_id, now)


def list_sessions(user_id: str) -> list[dict]:
    """Return summary of all active sessions for a user (via GSI)."""
    resp = _get_table().query(
        IndexName="user-sessions-index",
        KeyConditionExpression=Key("user_id").eq(user_id),
        ProjectionExpression="session_id, created_at, message_count",
        ScanIndexForward=False,  # newest first
        Limit=20,
    )
    return resp.get("Items", [])


def delete_session(session_id: str) -> None:
    _get_table().delete_item(
        Key={"session_id": session_id, "created_at": _session_created_at(session_id)},
    )


# ── Sort key cache (in-process) ───────────────────────────────────────────────
# The SK (created_at) is set on first write. We cache it in-memory to avoid
# an extra DynamoDB read on every subsequent turn in the same process lifetime.
_created_at_cache: dict[str, str] = {}


def _session_created_at(session_id: str) -> str:
    if session_id in _created_at_cache:
        return _created_at_cache[session_id]

    # Fall back to a DynamoDB scan on the PK (expensive, but rare after warm-up)
    resp = _get_table().query(
        KeyConditionExpression=Key("session_id").eq(session_id),
        ProjectionExpression="created_at",
        Limit=1,
    )
    items = resp.get("Items", [])
    if items:
        created_at = items[0]["created_at"]
        _created_at_cache[session_id] = created_at
        return created_at

    # Session not yet created — return a placeholder that will be overwritten
    return datetime.now(timezone.utc).isoformat()


def _store_created_at(session_id: str, created_at: str) -> None:
    _created_at_cache[session_id] = created_at
