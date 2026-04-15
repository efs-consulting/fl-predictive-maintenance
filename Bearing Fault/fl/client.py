from __future__ import annotations
import copy
import math
from dataclasses import dataclass

import torch
import torch.nn as nn

from config import FLConfig
from fl.data_manager import ClientDataset
from fl.models import build_model, get_model_weights, set_model_weights


@dataclass
class ClientUpdate:
    client_id: int
    weights: dict
    sample_count: int
    local_steps: int
    train_loss: float
    train_acc: float
    val_loss: float
    val_acc: float


class ClientTrainer:
    def __init__(self, client_id: int, dataset: ClientDataset, config: FLConfig, device: torch.device):
        self.client_id = client_id
        self.dataset = dataset
        self.config = config
        self.device = device
        self.model = build_model(config, device)

    def train(self, global_weights: dict) -> ClientUpdate:
        cfg = self.config
        set_model_weights(self.model, global_weights)
        self.model.train()

        train_loader, val_loader = self.dataset.to_torch_loaders(cfg.batch_size)

        # ── Optimizer ──────────────────────────────────────────────────────
        if cfg.optimizer == "adam":
            opt = torch.optim.Adam(self.model.parameters(), lr=cfg.learning_rate, weight_decay=cfg.weight_decay)
        elif cfg.optimizer == "adamw":
            opt = torch.optim.AdamW(self.model.parameters(), lr=cfg.learning_rate, weight_decay=cfg.weight_decay)
        else:
            opt = torch.optim.SGD(self.model.parameters(), lr=cfg.learning_rate,
                                  momentum=0.9, weight_decay=cfg.weight_decay)

        # ── Scheduler ──────────────────────────────────────────────────────
        if cfg.lr_scheduler == "step":
            scheduler = torch.optim.lr_scheduler.StepLR(opt, step_size=1, gamma=0.9)
        elif cfg.lr_scheduler == "cosine":
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=cfg.local_epochs)
        elif cfg.lr_scheduler == "warmup_cosine":
            # Linear warmup for the first epoch, then cosine annealing
            warmup  = torch.optim.lr_scheduler.LinearLR(
                opt, start_factor=0.1, end_factor=1.0, total_iters=1)
            cosine  = torch.optim.lr_scheduler.CosineAnnealingLR(
                opt, T_max=max(1, cfg.local_epochs - 1))
            scheduler = torch.optim.lr_scheduler.SequentialLR(
                opt, schedulers=[warmup, cosine], milestones=[1])
        else:
            scheduler = None

        criterion = nn.CrossEntropyLoss(label_smoothing=cfg.label_smoothing)

        # FedProx: keep a frozen copy of global weights for the proximal term
        if cfg.aggregation_strategy == "fedprox":
            global_params = [p.detach().clone() for p in self.model.parameters()]

        local_steps = 0
        final_train_loss, final_train_acc = 0.0, 0.0

        for _ in range(cfg.local_epochs):
            epoch_loss, epoch_correct, epoch_total = 0.0, 0, 0

            for X_batch, y_batch in train_loader:
                X_batch, y_batch = X_batch.to(self.device), y_batch.to(self.device)

                # ── Data augmentation: Gaussian noise ────────────────────────
                if cfg.use_augmentation and cfg.aug_noise_std > 0:
                    X_batch = X_batch + torch.randn_like(X_batch) * cfg.aug_noise_std

                opt.zero_grad()
                logits = self.model(X_batch)
                loss = criterion(logits, y_batch)

                # FedProx proximal term
                if cfg.aggregation_strategy == "fedprox":
                    prox = sum(
                        ((p - p0.to(self.device)) ** 2).sum()
                        for p, p0 in zip(self.model.parameters(), global_params)
                    )
                    loss = loss + (cfg.fedprox_mu / 2.0) * prox

                loss.backward()
                if cfg.grad_clip > 0:
                    torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=cfg.grad_clip)
                opt.step()

                epoch_loss += loss.item() * len(y_batch)
                epoch_correct += (logits.argmax(1) == y_batch).sum().item()
                epoch_total += len(y_batch)
                local_steps += 1

            if scheduler:
                scheduler.step()

            final_train_loss = epoch_loss / max(epoch_total, 1)
            final_train_acc = epoch_correct / max(epoch_total, 1)

        val_loss, val_acc = self._evaluate(val_loader, criterion)

        return ClientUpdate(
            client_id=self.client_id,
            weights=get_model_weights(self.model),
            sample_count=len(self.dataset.y_train),
            local_steps=local_steps,
            train_loss=round(final_train_loss, 6),
            train_acc=round(final_train_acc, 6),
            val_loss=round(val_loss, 6),
            val_acc=round(val_acc, 6),
        )

    def _evaluate(self, loader, criterion) -> tuple[float, float]:
        self.model.eval()
        total_loss, correct, total = 0.0, 0, 0
        with torch.no_grad():
            for X_batch, y_batch in loader:
                X_batch, y_batch = X_batch.to(self.device), y_batch.to(self.device)
                logits = self.model(X_batch)
                loss = criterion(logits, y_batch)
                total_loss += loss.item() * len(y_batch)
                correct += (logits.argmax(1) == y_batch).sum().item()
                total += len(y_batch)
        self.model.train()
        return total_loss / max(total, 1), correct / max(total, 1)
