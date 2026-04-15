"""
Centralised runtime settings loaded from environment variables.

Override any value by setting the corresponding variable in your shell or
in a `.env` file at the project root (loaded automatically when present).

Examples
--------
    DATA_DIR=/mnt/datasets/cwru   python -m uvicorn main:app
    LOG_LEVEL=DEBUG  PORT=8080  ./run.sh
"""
from __future__ import annotations
import os
import pathlib

_HERE = pathlib.Path(__file__).parent

# Load .env file if present (no-op when python-dotenv is not installed)
try:
    from dotenv import load_dotenv
    load_dotenv(_HERE / ".env", override=False)
except ImportError:
    pass

# ── Directories ───────────────────────────────────────────────────────────────
# DATA_DIR   : pre-processed dataset files  (X.npy, y.npy, meta.csv)
# MODELS_DIR : saved model checkpoints      (.pt files + index.json)
DATA_DIR   = pathlib.Path(os.environ.get("DATA_DIR",   str(_HERE / "data")))
MODELS_DIR = pathlib.Path(os.environ.get("MODELS_DIR", str(_HERE / "models")))

# ── Server ────────────────────────────────────────────────────────────────────
HOST      = os.environ.get("HOST",      "0.0.0.0")
PORT      = int(os.environ.get("PORT",  "8001"))
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
RELOAD    = os.environ.get("RELOAD",    "false").lower() == "true"
