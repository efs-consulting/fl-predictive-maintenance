from __future__ import annotations
import asyncio
import io
import json
import logging
import os
import pathlib
from contextlib import asynccontextmanager
from typing import List, Set

import httpx

import numpy as np
import torch
from fastapi import FastAPI, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import settings
from config import FLConfig, LABEL_NAMES, NUM_CLASSES

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL, logging.INFO),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("bearingfl")

# ── Chat system prompt ────────────────────────────────────────────────────────
_CHAT_SYSTEM = """\
You are BearingFL Assistant, an AI expert embedded in the BearingFL Federated \
Learning Dashboard for rotating machinery bearing fault diagnosis.

SYSTEM CONTEXT:
- Dataset: CWRU (Case Western Reserve University) bearing dataset, ~14 k samples, \
1024-sample vibration windows
- Task: 4-class bearing fault classification: Normal, Inner Race (IR), \
Outer Race (OR), Ball fault
- Framework: Federated Learning — multiple simulated clients train local models \
and aggregate into a global model

AVAILABLE MODELS: CNN1D · ResNet1D · BiLSTM (CNN front-end + bidirectional LSTM) \
· TCN (dilated temporal convolutions)

FL AGGREGATION STRATEGIES:
- FedAvg: weighted average of all client weights
- FedProx: FedAvg + proximal term μ penalising client drift
- FedNova: normalised averaging correcting for unequal local steps
- FedBN: FedAvg but skips BatchNorm statistics (clients keep local BN)

KEY SETTINGS: num_clients (2–20), rounds (1–100), local_epochs, fraction_fit, \
partition (IID / Dirichlet / by-load), lr_scheduler \
(none / step / cosine / warmup_cosine), grad_clip, label_smoothing, \
Gaussian noise augmentation, early stopping

DASHBOARD TABS:
- Dashboard: live training monitoring — accuracy/loss curves, \
client participation badges, confusion matrix
- Predict: upload or sample a vibration signal, run inference with one or more \
saved models, view ensemble result
- Benchmark: compare saved models side-by-side — accuracy, F1, precision, \
recall, inference time, per-class breakdown, confusion matrices

Answer concisely and technically. Use markdown (**bold**, `code`) when helpful. \
If the user asks something outside this domain, politely redirect them.\
"""

ROOT       = pathlib.Path(__file__).parent
STATIC     = ROOT / "static"
MODELS_DIR = settings.MODELS_DIR
INDEX_FILE = MODELS_DIR / "index.json"


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(
        "BearingFL API starting up | data=%s | models=%s",
        settings.DATA_DIR, MODELS_DIR,
    )
    if not (settings.DATA_DIR / "X.npy").exists():
        logger.warning(
            "Dataset not found in %s — run `python get_data.py` to download and "
            "pre-process the CWRU data before starting a training run.",
            settings.DATA_DIR,
        )
    yield
    logger.info("BearingFL API shut down.")


app = FastAPI(title="Bearing Fault FL Dashboard", version="1.0.0", lifespan=lifespan)

# ── App state ─────────────────────────────────────────────────────────────────
active_connections: Set[WebSocket] = set()
_ws_lock      = asyncio.Lock()
current_task: asyncio.Task | None  = None
is_training   = False
current_server = None

# In-memory cache: model_id → nn.Module (loaded on first use, evicted on delete)
_model_cache: dict[str, torch.nn.Module] = {}


# ── Model library helpers ─────────────────────────────────────────────────────

def _read_index() -> list[dict]:
    if INDEX_FILE.exists():
        try:
            return json.loads(INDEX_FILE.read_text())
        except Exception:
            return []
    return []


def _write_index(entries: list[dict]) -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    INDEX_FILE.write_text(json.dumps(entries, indent=2))


def _load_model(model_id: str) -> torch.nn.Module:
    """Load a model by ID (with in-memory caching)."""
    if model_id in _model_cache:
        return _model_cache[model_id]

    ckpt_path = MODELS_DIR / f"{model_id}.pt"
    if not ckpt_path.exists():
        raise FileNotFoundError(f"Model file not found: {model_id}.pt")

    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    from fl.models import build_model, set_model_weights
    cfg = FLConfig(**ckpt["config"])
    model = build_model(cfg, torch.device("cpu"))
    set_model_weights(model, ckpt["state_dict"])
    model.eval()
    _model_cache[model_id] = model
    return model


def _segment_signal(signal: np.ndarray, window: int = 1024, step: int = 512) -> np.ndarray:
    n = (len(signal) - window) // step + 1
    return np.stack([signal[i * step: i * step + window] for i in range(n)])


def _run_model(model: torch.nn.Module, windows: np.ndarray) -> list[dict]:
    """Normalize + infer on (N, 1024) array. Returns per-window result dicts."""
    mu    = windows.mean(axis=1, keepdims=True)
    sigma = windows.std(axis=1, keepdims=True) + 1e-8
    X     = torch.tensor((windows - mu) / sigma, dtype=torch.float32)
    with torch.no_grad():
        probs = torch.softmax(model(X), dim=1).numpy()
    results = []
    for i, p in enumerate(probs):
        pred = int(p.argmax())
        results.append({
            "window":       i,
            "class_id":     pred,
            "class_name":   LABEL_NAMES[pred],
            "confidence":   round(float(p[pred]), 4),
            "probabilities": {LABEL_NAMES[j]: round(float(p[j]), 4) for j in range(NUM_CLASSES)},
        })
    return results


def _dominant(results: list[dict]) -> dict:
    """Return the single highest-confidence window result."""
    return max(results, key=lambda r: r["confidence"])


def _avg_probs(results: list[dict]) -> dict:
    """Average probabilities across windows."""
    avg = {LABEL_NAMES[j]: 0.0 for j in range(NUM_CLASSES)}
    n   = len(results)
    for r in results:
        for k, v in r["probabilities"].items():
            avg[k] += v / n
    return {k: round(v, 4) for k, v in avg.items()}


def _ensemble(per_model: list[dict]) -> dict:
    """Majority vote + averaged probabilities across models."""
    votes: dict[str, int] = {LABEL_NAMES[j]: 0 for j in range(NUM_CLASSES)}
    sum_p: dict[str, float] = {LABEL_NAMES[j]: 0.0 for j in range(NUM_CLASSES)}
    n = len(per_model)
    for m in per_model:
        dom = m["dominant"]
        votes[dom["class_name"]] += 1
        for k, v in m["avg_probabilities"].items():
            sum_p[k] += v
    avg_p = {k: round(v / n, 4) for k, v in sum_p.items()}
    winner = max(votes, key=lambda k: (votes[k], avg_p[k]))
    return {
        "class_name":    winner,
        "class_id":      next(j for j in range(NUM_CLASSES) if LABEL_NAMES[j] == winner),
        "votes":         votes,
        "total_models":  n,
        "probabilities": avg_p,
    }


def _get_model_meta(model_id: str) -> dict:
    for m in _read_index():
        if m["id"] == model_id:
            return m
    return {}


def _multi_predict(windows: np.ndarray, model_ids: list[str]) -> dict:
    """Run all requested models and build the unified response."""
    per_model = []
    for mid in model_ids:
        model = _load_model(mid)
        meta  = _get_model_meta(mid)
        results = _run_model(model, windows)
        dom  = _dominant(results)
        avgp = _avg_probs(results)
        per_model.append({
            "model_id":         mid,
            "label":            f"{meta.get('model_type','?').upper()} · {meta.get('aggregation_strategy','?').upper()} · {meta.get('num_clients','?')}c · {meta.get('num_rounds','?')}r",
            "best_accuracy":    meta.get("best_accuracy"),
            "model_type":       meta.get("model_type"),
            "aggregation_strategy": meta.get("aggregation_strategy"),
            "results":          results,
            "dominant":         dom,
            "avg_probabilities": avgp,
        })

    response: dict = {"num_windows": len(windows), "predictions": per_model}
    if len(per_model) > 1:
        response["ensemble"] = _ensemble(per_model)
    return response


# ── WebSocket broadcast ───────────────────────────────────────────────────────

async def broadcast(message: dict):
    text = json.dumps(message)
    dead = set()
    for ws in list(active_connections):
        try:
            await ws.send_text(text)
        except Exception:
            dead.add(ws)
    async with _ws_lock:
        active_connections.difference_update(dead)


# ── REST: health & config ─────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "training": is_training}


@app.get("/api/config/defaults")
async def config_defaults():
    return FLConfig().model_dump()


# ── REST: model library ───────────────────────────────────────────────────────

@app.get("/api/models")
async def list_models():
    return {"models": _read_index()}


@app.delete("/api/models/{model_id}")
async def delete_model(model_id: str):
    index = _read_index()
    entry = next((e for e in index if e["id"] == model_id), None)
    if entry is None:
        raise HTTPException(status_code=404, detail="Model not found.")
    ckpt_path = MODELS_DIR / entry["file"]
    if ckpt_path.exists():
        ckpt_path.unlink()
    _model_cache.pop(model_id, None)
    _write_index([e for e in index if e["id"] != model_id])
    return {"status": "deleted", "model_id": model_id}


# ── REST: predict ─────────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    signal: List[float]
    model_ids: List[str]


@app.post("/api/predict")
async def predict_json(payload: PredictRequest):
    if not payload.model_ids:
        raise HTTPException(status_code=422, detail="Select at least one model.")
    sig = np.array(payload.signal, dtype=np.float32)
    if len(sig) < 1024:
        raise HTTPException(status_code=422,
                            detail=f"Signal too short: got {len(sig)}, need ≥ 1024 values.")
    windows = _segment_signal(sig) if len(sig) > 1024 else sig.reshape(1, -1)
    try:
        return _multi_predict(windows, payload.model_ids)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/predict/upload")
async def predict_upload(file: UploadFile, model_ids: str = Form(default="[]")):
    ids = json.loads(model_ids)
    if not ids:
        raise HTTPException(status_code=422, detail="Select at least one model.")
    content = await file.read()
    name    = (file.filename or "").lower()
    try:
        if name.endswith(".npy"):
            sig = np.load(io.BytesIO(content)).astype(np.float32).ravel()
        else:
            text = content.decode("utf-8", errors="replace")
            nums = [float(x) for x in text.replace(",", " ").replace(";", " ").split()
                    if x.strip()]
            sig  = np.array(nums, dtype=np.float32)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not parse file: {exc}")
    if len(sig) < 1024:
        raise HTTPException(status_code=422,
                            detail=f"Signal too short: got {len(sig)}, need ≥ 1024.")
    windows = _segment_signal(sig) if len(sig) > 1024 else sig.reshape(1, -1)
    try:
        return _multi_predict(windows, ids)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


class BenchmarkRequest(BaseModel):
    model_ids: List[str]


@app.post("/api/benchmark")
async def run_benchmark(payload: BenchmarkRequest):
    """Evaluate every requested model on the same fixed test set (seed=42)
    and return detailed per-class metrics for side-by-side comparison."""
    if not payload.model_ids:
        raise HTTPException(status_code=422, detail="Select at least one model.")
    if len(payload.model_ids) > 12:
        raise HTTPException(status_code=422, detail="Maximum 12 models per benchmark run.")

    from fl.data_manager import DataManager
    from fl.metrics import benchmark_model as _bm

    dm = DataManager()
    _, test_idx = dm.split_global_test(seed=42)
    test_loader = dm.get_test_loader(test_idx, batch_size=256)

    results = []
    for mid in payload.model_ids:
        try:
            model  = _load_model(mid)
            meta   = _get_model_meta(mid)
            metrics = _bm(model, test_loader, torch.device("cpu"))
            num_params = sum(p.numel() for p in model.parameters())

            mtype = meta.get("model_type", "?")
            strat = meta.get("aggregation_strategy", "?")
            nc    = meta.get("num_clients", "?")
            nr    = meta.get("num_rounds", "?")
            label_map = {"cnn1d": "CNN1D", "resnet1d": "ResNet1D",
                         "lstm1d": "BiLSTM", "tcn": "TCN"}
            mtype_label = label_map.get(mtype, mtype.upper())

            results.append({
                "model_id":    mid,
                "label":       f"{mtype_label} · {strat.upper()} · {nc}c · {nr}r",
                "short_label": f"{mtype_label} {nr}r",
                "meta":        meta,
                "num_params":  num_params,
                **metrics,
            })
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))

    return {
        "test_samples": len(test_idx),
        "class_names":  [LABEL_NAMES[i] for i in range(NUM_CLASSES)],
        "models":       results,
    }


@app.get("/api/predict/sample")
async def predict_sample(class_id: int = -1):
    X = np.load(settings.DATA_DIR / "X.npy")
    y = np.load(settings.DATA_DIR / "y.npy")
    if class_id >= 0:
        pool = np.where(y == class_id)[0]
        if len(pool) == 0:
            raise HTTPException(status_code=404, detail="No samples for that class.")
        idx = int(np.random.choice(pool))
    else:
        idx = int(np.random.randint(len(y)))
    return {
        "signal":          X[idx].tolist(),
        "true_class_id":   int(y[idx]),
        "true_class_name": LABEL_NAMES[int(y[idx])],
        "sample_index":    idx,
    }


# ── REST: training ────────────────────────────────────────────────────────────

@app.post("/api/train")
async def start_training(config: FLConfig):
    global current_task, is_training, current_server
    if is_training:
        return {"status": "already_running"}
    from fl.server import FLServer
    is_training    = True
    current_server = FLServer(config, broadcast)

    async def _run():
        global is_training, current_server
        try:
            await current_server.run()
        except asyncio.CancelledError:
            await broadcast({"type": "LOG", "level": "WARNING",
                             "message": "Training cancelled.", "timestamp": ""})
        except Exception as exc:
            logger.exception("Training failed: %s", exc)
            await broadcast({"type": "TRAINING_ERROR", "message": str(exc), "round": -1})
            raise
        finally:
            is_training = False

    current_task = asyncio.create_task(_run())
    return {"status": "started"}


@app.post("/api/stop")
async def stop_training():
    global current_task, is_training, current_server
    if current_server:
        current_server.stop()
    if current_task and not current_task.done():
        current_task.cancel()
    is_training = False
    return {"status": "stopped"}


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    async with _ws_lock:
        active_connections.add(ws)
    try:
        await ws.send_text(json.dumps({"type": "CONNECTED", "message": "WebSocket connected"}))
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        async with _ws_lock:
            active_connections.discard(ws)


# ── Chat ──────────────────────────────────────────────────────────────────────

class ChatMsg(BaseModel):
    role: str      # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: List[ChatMsg] = []
    session_context: str = ""   # compact session summary built by the frontend


@app.post("/api/chat")
async def chat_endpoint(payload: ChatRequest):
    """
    Chat routing (priority order):

    1. LM Studio at llm.taktik.net — OpenAI-compatible streaming endpoint.
       Uses stream=True to satisfy Cloudflare's 100 s idle-timeout; SSE chunks
       are accumulated on the backend and returned as a single JSON reply.

    2. Anthropic Claude API — fallback when the primary is unreachable.

    3. Friendly error message — if neither backend is available.
    """
    lm_base_url = os.environ.get("LM_STUDIO_BASE_URL", "").rstrip("/")
    lm_api_key  = os.environ.get("LM_STUDIO_API_KEY",  "").strip()

    # Build the full system prompt: static knowledge + live session data
    system_content = _CHAT_SYSTEM
    if payload.session_context.strip():
        system_content += "\n\n" + payload.session_context.strip()

    messages = [{"role": "system", "content": system_content}]
    for m in payload.history[-10:]:
        messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": payload.message})

    # ── Primary: LM Studio / llm.taktik.net (OpenAI-compatible, streaming) ───
    if lm_base_url and lm_api_key:
        try:
            headers = {
                "Authorization": f"Bearer {lm_api_key}",
                "Content-Type":  "application/json",
                "Accept":        "text/event-stream",
            }
            body = {
                "model":       "google/gemma-4-26b-a4b",
                "messages":    messages,
                "stream":      True,          # REQUIRED — resets CF 100 s idle timer per chunk
                "max_tokens":  600,
                "temperature": 0.7,
            }

            reply_chunks: list[str] = []

            async with httpx.AsyncClient(timeout=300.0) as client:
                async with client.stream(
                    "POST",
                    f"{lm_base_url}/chat/completions",
                    headers=headers,
                    json=body,
                ) as resp:
                    # Read error body while connection is still open
                    if resp.status_code >= 400:
                        await resp.aread()
                        err_body = resp.text
                        logger.error("LM Studio HTTP %s: %s", resp.status_code, err_body)
                        raise HTTPException(status_code=resp.status_code, detail=err_body)

                    async for raw_line in resp.aiter_lines():
                        if not raw_line.startswith("data: "):
                            continue
                        payload_str = raw_line[6:].strip()
                        if payload_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(payload_str)
                            delta = chunk["choices"][0]["delta"].get("content", "")
                            if delta:
                                reply_chunks.append(delta)
                        except (json.JSONDecodeError, KeyError, IndexError):
                            pass

            return {"reply": "".join(reply_chunks)}
        except httpx.ConnectError as exc:
            logger.error("LM Studio unreachable: %s", exc)
            raise HTTPException(status_code=502, detail=f"LM Studio unreachable: {exc}")
        except httpx.TimeoutException as exc:
            logger.error("LM Studio timeout: %s", exc)
            raise HTTPException(status_code=504, detail=f"LM Studio timed out: {exc}")
        except Exception as exc:
            logger.error("LM Studio error: %s", exc)
            raise HTTPException(status_code=500, detail=f"LM Studio error: {exc}")

    # ── Fallback: Anthropic Claude API ────────────────────────────────────────
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if api_key:
        try:
            import anthropic
            client   = anthropic.Anthropic(api_key=api_key)
            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=600,
                system=system_content,
                messages=messages[1:],   # strip the system message (passed separately)
            )
            return {"reply": response.content[0].text}
        except Exception as exc:
            logger.error("Anthropic fallback failed: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    # ── No backend available ──────────────────────────────────────────────────
    return {
        "reply": (
            "**AI assistant not configured.**\n\n"
            "Set `LM_STUDIO_BASE_URL` and `LM_STUDIO_API_KEY` in your `.env` file "
            "to enable the AI chat feature."
        )
    }


# ── Static files + SPA fallback ───────────────────────────────────────────────

app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    return FileResponse(str(STATIC / "index.html"))
