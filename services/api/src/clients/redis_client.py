"""
Shared Redis client for semantic and response caching.
"""
import os
import redis

_client = None


def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis(
            host=os.environ["CACHE_HOST"],
            port=int(os.environ.get("CACHE_PORT", "6379")),
            ssl=True,
            decode_responses=False,  # raw bytes — we handle serialisation ourselves
            socket_connect_timeout=5,
            socket_timeout=5,
            retry_on_timeout=True,
        )
    return _client
