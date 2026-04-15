# ─────────────────────────────────────────────────────────────────────────────
# BearingFL API — Dockerfile
#
# Builds the FastAPI + PyTorch backend service.
#
# GPU note
# --------
# The default build installs the CPU-only PyTorch wheel (smaller image, works
# everywhere).  For GPU support, build with:
#   docker build --build-arg TORCH_VARIANT=cu121 -t bearingfl-api .
# and use a CUDA-compatible base image or override at runtime.
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim

# PyTorch variant: "cpu" (default) or a CUDA channel, e.g. "cu121"
ARG TORCH_VARIANT=cpu
ARG TORCH_INDEX=https://download.pytorch.org/whl/${TORCH_VARIANT}

WORKDIR /app

# ── System packages ───────────────────────────────────────────────────────────
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      gcc \
      curl \
 && rm -rf /var/lib/apt/lists/*

# ── Python dependencies ───────────────────────────────────────────────────────
COPY requirements.txt ./

# Install PyTorch first from the specified index so pip satisfies
# the `torch>=2.1` constraint without pulling the heavier default wheel.
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir torch --index-url ${TORCH_INDEX} \
 && pip install --no-cache-dir -r requirements.txt

# ── Application source ────────────────────────────────────────────────────────
COPY main.py config.py settings.py get_data.py ./
COPY fl/      ./fl/
COPY static/  ./static/

# ── Runtime mount points (overridden by volumes in docker-compose) ─────────────
RUN mkdir -p /app/data /app/models

# ── Non-root user ─────────────────────────────────────────────────────────────
RUN adduser --system --no-create-home --uid 1000 appuser \
 && chown -R appuser /app/data /app/models

USER appuser

# ── Environment defaults ──────────────────────────────────────────────────────
ENV DATA_DIR=/app/data \
    MODELS_DIR=/app/models \
    LOG_LEVEL=INFO \
    PORT=8001 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 8001

# ── Health check ──────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -sf http://localhost:8001/api/health || exit 1

# ── Entrypoint ────────────────────────────────────────────────────────────────
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8001", \
     "--workers", "1", \
     "--log-level", "info"]
