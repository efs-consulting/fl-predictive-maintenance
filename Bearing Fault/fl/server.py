from __future__ import annotations
import asyncio
import copy
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Awaitable, Callable

import numpy as np
import torch

import settings

MODELS_DIR = settings.MODELS_DIR
INDEX_FILE = MODELS_DIR / "index.json"

from config import FLConfig, LABEL_NAMES, NUM_CLASSES
from fl.aggregators import fedavg, fedbn, fedprox, fednova
from fl.client import ClientTrainer, ClientUpdate
from fl.data_manager import DataManager
from fl.metrics import compute_confusion_matrix, evaluate_global
from fl.models import build_model, get_model_weights, set_model_weights

BroadcastFn = Callable[[dict], Awaitable[None]]


# ── Model index helpers ───────────────────────────────────────────────────────

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


def _save_model_to_library(global_model, cfg: FLConfig,
                            final_acc: float, best_acc: float,
                            best_round: int, cm: list) -> tuple[str, dict]:
    """Save model weights + metadata to the library. Returns (model_id, meta)."""
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    model_id = f"model_{ts}"
    # Ensure uniqueness in the rare case of same-second saves
    existing_ids = {e["id"] for e in _read_index()}
    counter = 1
    while model_id in existing_ids:
        model_id = f"model_{ts}_{counter}"
        counter += 1

    ckpt_path = MODELS_DIR / f"{model_id}.pt"
    torch.save({
        "state_dict": get_model_weights(global_model),
        "config": cfg.model_dump(),
        "class_names": [LABEL_NAMES[i] for i in range(NUM_CLASSES)],
        "final_accuracy": round(final_acc, 6),
        "best_accuracy":  round(best_acc, 6),
        "best_round":     best_round,
    }, ckpt_path)

    meta = {
        "id":                   model_id,
        "created_at":           datetime.now(timezone.utc).isoformat(),
        "file":                 f"{model_id}.pt",
        "model_type":           cfg.model_type,
        "aggregation_strategy": cfg.aggregation_strategy,
        "partition_strategy":   cfg.partition_strategy,
        "num_clients":          cfg.num_clients,
        "num_rounds":           cfg.num_rounds,
        "local_epochs":         cfg.local_epochs,
        "learning_rate":        cfg.learning_rate,
        "optimizer":            cfg.optimizer,
        "dirichlet_alpha":      cfg.dirichlet_alpha,
        "best_accuracy":        round(best_acc, 6),
        "final_accuracy":       round(final_acc, 6),
        "best_round":           best_round,
        "config":               cfg.model_dump(),
    }
    index = _read_index()
    index.append(meta)
    _write_index(index)
    return model_id, meta


# ── FL Server ─────────────────────────────────────────────────────────────────

class FLServer:
    def __init__(self, config: FLConfig, broadcast: BroadcastFn):
        self.config = config
        self.broadcast = broadcast
        self._stop = False
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    def stop(self):
        self._stop = True

    async def run(self):
        cfg = self.config
        t0 = time.time()

        await self._log("INFO", f"Device: {self.device} | Strategy: {cfg.aggregation_strategy.upper()} | Model: {cfg.model_type.upper()}")
        await self._log("INFO", f"Loading & partitioning data into {cfg.num_clients} clients ({cfg.partition_strategy}) …")

        # ── Data ────────────────────────────────────────────────────────────
        dm = DataManager()
        train_idx, test_idx = dm.split_global_test(seed=cfg.seed)
        client_datasets = dm.partition(cfg, train_idx)
        test_loader = dm.get_test_loader(test_idx, batch_size=256)

        dist_summary = dm.distribution_summary(client_datasets)
        await self.broadcast({
            "type": "DATA_DISTRIBUTION",
            "clients": dist_summary,
            "global_test_samples": len(test_idx),
            "partition_strategy": cfg.partition_strategy,
            "alpha": cfg.dirichlet_alpha,
        })
        await self._log("SUCCESS", f"Data partitioned. Global test set: {len(test_idx)} samples.")

        # ── Model + Clients ──────────────────────────────────────────────────
        global_model = build_model(cfg, self.device)
        trainers = [ClientTrainer(ds.client_id, ds, cfg, self.device) for ds in client_datasets]

        best_acc, best_round = 0.0, 0
        executor = ThreadPoolExecutor(max_workers=min(cfg.num_clients, 8))
        loop = asyncio.get_event_loop()

        # ── FL Rounds ────────────────────────────────────────────────────────
        for rnd in range(1, cfg.num_rounds + 1):
            if self._stop:
                await self._log("WARNING", "Training stopped by user.")
                break

            n_select = max(1, math.ceil(cfg.fraction_fit * cfg.num_clients))
            selected_ids = sorted(
                np.random.default_rng(cfg.seed + rnd)
                  .choice(cfg.num_clients, n_select, replace=False).tolist()
            )
            await self.broadcast({"type": "ROUND_START", "round": rnd,
                                   "num_rounds": cfg.num_rounds,
                                   "selected_clients": selected_ids})
            await self._log("INFO", f"Round {rnd}/{cfg.num_rounds} — Selected clients: {selected_ids}")

            global_weights = get_model_weights(global_model)

            futures = [
                loop.run_in_executor(executor, trainers[cid].train, copy.deepcopy(global_weights))
                for cid in selected_ids
            ]
            updates: list[ClientUpdate] = await asyncio.gather(*futures)

            client_w      = [u.weights       for u in updates]
            sample_counts = [u.sample_count  for u in updates]

            if cfg.aggregation_strategy == "fedavg":
                new_weights = fedavg(client_w, sample_counts)
            elif cfg.aggregation_strategy == "fedprox":
                new_weights = fedprox(client_w, sample_counts, global_weights, cfg.fedprox_mu)
            elif cfg.aggregation_strategy == "fedbn":
                new_weights = fedbn(client_w, sample_counts)
            else:  # fednova
                local_steps = [u.local_steps for u in updates]
                new_weights = fednova(client_w, sample_counts, local_steps, global_weights)

            set_model_weights(global_model, new_weights)

            g_loss, g_acc = evaluate_global(global_model, test_loader, self.device)
            if g_acc > best_acc:
                best_acc, best_round = g_acc, rnd

            # ── Early stopping ────────────────────────────────────────────────
            _early_stop = (
                cfg.early_stopping_patience > 0
                and (rnd - best_round) >= cfg.early_stopping_patience
            )

            client_info = [
                {"client_id": u.client_id, "train_loss": u.train_loss,
                 "train_acc": u.train_acc,  "val_loss": u.val_loss,
                 "val_acc": u.val_acc,       "samples": u.sample_count,
                 "local_steps": u.local_steps}
                for u in updates
            ]
            elapsed = round(time.time() - t0, 1)
            await self.broadcast({
                "type": "ROUND_COMPLETE",
                "round": rnd, "num_rounds": cfg.num_rounds,
                "global": {"loss": round(g_loss, 6), "accuracy": round(g_acc, 6)},
                "clients": client_info,
                "selected_clients": selected_ids,
                "elapsed_seconds": elapsed,
            })
            await self._log(
                "SUCCESS" if g_acc >= best_acc else "INFO",
                f"Round {rnd}/{cfg.num_rounds} — Loss: {g_loss:.4f}  Acc: {g_acc*100:.2f}%"
                f"  (best: {best_acc*100:.2f}% @ round {best_round})"
            )

            if _early_stop:
                await self._log("WARNING",
                    f"Early stopping triggered — no improvement for "
                    f"{cfg.early_stopping_patience} rounds.")
                break

        # ── Final evaluation + save ───────────────────────────────────────────
        if not self._stop:
            g_loss, g_acc = evaluate_global(global_model, test_loader, self.device)
            cm = compute_confusion_matrix(global_model, test_loader, self.device)
            total_elapsed = round(time.time() - t0, 1)

            model_id, meta = _save_model_to_library(
                global_model, cfg, g_acc, best_acc, best_round, cm
            )
            await self._log("SUCCESS", f"Model saved → {model_id}  (best acc: {best_acc*100:.2f}%)")

            await self.broadcast({
                "type": "TRAINING_COMPLETE",
                "model_id":        model_id,
                "model_meta":      meta,
                "best_round":      best_round,
                "best_accuracy":   round(best_acc, 6),
                "final_accuracy":  round(g_acc, 6),
                "final_loss":      round(g_loss, 6),
                "confusion_matrix": cm,
                "class_names":     [LABEL_NAMES[i] for i in range(NUM_CLASSES)],
                "total_elapsed_seconds": total_elapsed,
            })
            await self._log("SUCCESS",
                f"Training complete! Best: {best_acc*100:.2f}% @ round {best_round}. "
                f"Total time: {total_elapsed}s")

    async def _log(self, level: str, message: str):
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
        await self.broadcast({"type": "LOG", "level": level,
                               "message": message, "timestamp": ts})
