#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# BearingFL — Local development launcher (no Docker)
#
# For Docker-based deployment use:
#   docker compose up --build
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Activate virtualenv if present
if [ -f "venv/bin/activate" ]; then
  source venv/bin/activate
fi

# Load .env if present
if [ -f ".env" ]; then
  set -o allexport
  source .env
  set +o allexport
fi

PORT="${PORT:-8001}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  BearingFL — Federated Learning Dashboard"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  URL  : http://localhost:${PORT}"
echo "  Stop : Ctrl+C"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

uvicorn main:app \
  --host "${HOST:-0.0.0.0}" \
  --port "${PORT}" \
  --reload
