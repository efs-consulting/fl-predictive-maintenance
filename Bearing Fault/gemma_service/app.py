"""
BearingFL — Gemma Inference Microservice
=========================================
Loads google/gemma-4-E2B (or any model specified via GEMMA_MODEL_ID) and
exposes a minimal REST API used by the BearingFL FastAPI backend.

Environment variables
---------------------
  GEMMA_MODEL_ID   HuggingFace model ID (default: google/gemma-4-E2B)
  HF_TOKEN         HuggingFace access token — required for gated models.
                   Accept the model licence at huggingface.co first.
  MAX_NEW_TOKENS   Max tokens to generate per reply (default: 600)
  DEVICE           "cpu" or "cuda" — auto-detected if not set

Endpoints
---------
  GET  /health        Liveness probe
  POST /chat          Generate a reply
"""
from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager
from typing import List, Optional

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer

# ── Config ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("gemma_service")

MODEL_ID       = os.environ.get("GEMMA_MODEL_ID", "google/gemma-4-E2B")
HF_TOKEN       = os.environ.get("HF_TOKEN", "").strip()
MAX_NEW_TOKENS = int(os.environ.get("MAX_NEW_TOKENS", "600"))

# Device selection: prefer CUDA, fall back to CPU
_requested_device = os.environ.get("DEVICE", "").lower()
if _requested_device in ("cuda", "gpu"):
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
elif _requested_device == "cpu":
    DEVICE = "cpu"
else:
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Use bfloat16 on GPU (efficient), float32 on CPU (compat)
DTYPE = torch.bfloat16 if DEVICE == "cuda" else torch.float32

# Use all available CPU cores for faster inference
_cpu_threads = int(os.environ.get("NUM_THREADS", os.cpu_count() or 4))
torch.set_num_threads(_cpu_threads)
torch.set_num_interop_threads(max(1, _cpu_threads // 2))
logger.info("CPU threads: %d (interop: %d)", _cpu_threads, max(1, _cpu_threads // 2))

# ── Globals (populated during startup) ────────────────────────────────────────
_tokenizer: Optional[AutoTokenizer] = None
_model:     Optional[AutoModelForCausalLM] = None


# ── Lifespan: load model once at startup ─────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _tokenizer, _model

    logger.info("Loading model %s on %s (dtype=%s) …", MODEL_ID, DEVICE, DTYPE)
    hf_kwargs: dict = {}
    if HF_TOKEN:
        hf_kwargs["token"] = HF_TOKEN
    else:
        logger.warning(
            "HF_TOKEN is not set. If %s is a gated model you will get a 401. "
            "Set HF_TOKEN in your .env file.",
            MODEL_ID,
        )

    _tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, **hf_kwargs)

    model_kwargs: dict = {
        "dtype": DTYPE,
        **hf_kwargs,
    }
    if DEVICE == "cuda":
        # Spread across all available GPUs automatically
        model_kwargs["device_map"] = "auto"
    else:
        # On CPU, device_map causes issues — load normally then move
        model_kwargs["device_map"] = None
        model_kwargs["low_cpu_mem_usage"] = True

    _model = AutoModelForCausalLM.from_pretrained(MODEL_ID, **model_kwargs)

    if DEVICE == "cpu":
        _model = _model.to(DEVICE)

    _model.eval()
    logger.info("Model ready.")

    yield  # ← app is running

    logger.info("Unloading model …")
    del _model, _tokenizer


# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="BearingFL Gemma Service", version="1.0.0", lifespan=lifespan)


# ── Schemas ───────────────────────────────────────────────────────────────────
class ChatMsg(BaseModel):
    role: str       # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: List[ChatMsg] = []
    system: str = ""


class ChatResponse(BaseModel):
    reply: str
    model: str


# ── Helpers ───────────────────────────────────────────────────────────────────
def _build_conversation(payload: ChatRequest) -> list[dict]:
    """
    Build the conversation list that the tokenizer's chat template expects.

    Gemma's instruction format does not have a dedicated system role, so we
    inject the system prompt as a preamble in the first user turn.
    """
    history = list(payload.history[-10:])   # last 10 for context window safety

    conversation: list[dict] = []
    system_injected = False

    for msg in history:
        content = msg.content
        if msg.role == "user" and not system_injected and payload.system:
            content = f"{payload.system}\n\n{content}"
            system_injected = True
        conversation.append({"role": msg.role, "content": content})

    # Current user message
    current_content = payload.message
    if not system_injected and payload.system:
        current_content = f"{payload.system}\n\n{current_content}"

    conversation.append({"role": "user", "content": current_content})
    return conversation


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "ok" if _model is not None else "loading",
        "model": MODEL_ID,
        "device": DEVICE,
    }


@app.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest):
    if _model is None or _tokenizer is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet — try again shortly.")

    conversation = _build_conversation(payload)

    # Tokenise using the model's built-in chat template
    input_ids = _tokenizer.apply_chat_template(
        conversation,
        add_generation_prompt=True,
        return_tensors="pt",
    ).to(DEVICE)

    with torch.inference_mode():
        output_ids = _model.generate(
            input_ids,
            max_new_tokens=MAX_NEW_TOKENS,
            do_sample=True,
            temperature=0.7,
            top_p=0.9,
            repetition_penalty=1.1,
            pad_token_id=_tokenizer.eos_token_id,
            eos_token_id=_tokenizer.eos_token_id,
        )

    # Decode only the newly generated tokens (exclude the prompt)
    new_tokens = output_ids[0][input_ids.shape[-1]:]
    reply = _tokenizer.decode(new_tokens, skip_special_tokens=True).strip()

    return ChatResponse(reply=reply, model=MODEL_ID)
