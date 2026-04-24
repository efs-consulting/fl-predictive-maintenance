# ─────────────────────────────────────────────────────────────────────────────
# BearingFL — Gemma Inference Service
#
# Build args
# ----------
#   TORCH_VARIANT   "cpu" (default) | "cu121" | "cu118"  — selects the PyTorch
#                   index so the correct CUDA/CPU wheel is installed.
#
# Example GPU build:
#   docker build --build-arg TORCH_VARIANT=cu121 -t bearingfl-gemma .
#
# Notes
# -----
# • google/gemma-4-E2B is a gated model.  Set HF_TOKEN in your .env and
#   accept the licence at https://huggingface.co/google/gemma-4-E2B first.
# • Model weights are cached in the `gemma_cache` named volume (~8-9 GB).
#   The first cold start will download them; subsequent starts are fast.
# • CPU inference is slow (~60-90 s/reply for 4B).  A GPU is recommended.
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim

ARG TORCH_VARIANT=cpu
ARG TORCH_INDEX=https://download.pytorch.org/whl/${TORCH_VARIANT}

WORKDIR /app

# ── System packages ───────────────────────────────────────────────────────────
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      gcc \
      curl \
 && rm -rf /var/lib/apt/lists/*

# ── Python deps — PyTorch first, then the rest ───────────────────────────────
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir torch --index-url ${TORCH_INDEX}

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# ── App source ────────────────────────────────────────────────────────────────
COPY app.py ./

# ── HuggingFace cache directory ───────────────────────────────────────────────
RUN mkdir -p /model_cache

ENV HF_HOME=/model_cache \
    TRANSFORMERS_CACHE=/model_cache \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 8002

# ── Health check ──────────────────────────────────────────────────────────────
HEALTHCHECK --interval=60s --timeout=15s --start-period=300s --retries=3 \
  CMD curl -sf http://localhost:8002/health || exit 1

# ── Entrypoint ────────────────────────────────────────────────────────────────
CMD ["uvicorn", "app:app", \
     "--host", "0.0.0.0", \
     "--port", "8002", \
     "--workers", "1", \
     "--log-level", "info"]
