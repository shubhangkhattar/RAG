# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build
COPY requirements.txt .

RUN pip install --no-cache-dir --user -r requirements.txt

# ── Stage 2: minimal runtime image ───────────────────────────────────────────
FROM python:3.12-slim

# Non-root user — containers should never run as root
RUN useradd --create-home --shell /bin/bash appuser

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /root/.local /home/appuser/.local

# Copy application source
COPY src/ ./src/

RUN chown -R appuser:appuser /app
USER appuser

ENV PATH=/home/appuser/.local/bin:$PATH \
    PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 8000

# Single worker — Fargate scales horizontally via ECS task count, not vertically
# via uvicorn workers. Multiple workers per container would waste memory.
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--access-log"]
