"""
FastAPI application entry point.

Startup order matters:
  1. Environment variables must be set before any boto3 clients initialise.
  2. The LangGraph graph is compiled at import time (rag_graph module level)
     so the first request doesn't pay the compilation cost.
"""
import logging
import os

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from src.routes.chat import router as chat_router
from src.routes.sessions import router as sessions_router
from src.routes.admin import router as admin_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Enterprise RAG API",
    version="1.0.0",
    # Disable automatic /docs and /redoc in prod — they expose the schema publicly
    docs_url="/docs" if os.environ.get("STAGE") == "dev" else None,
    redoc_url=None,
)

app.include_router(chat_router)
app.include_router(sessions_router)
app.include_router(admin_router)


@app.get("/health", include_in_schema=False)
def health():
    """ALB and API Gateway health probe — no auth required."""
    return {"status": "ok"}


@app.exception_handler(Exception)
def unhandled_exception(request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"error": "internal server error"})
