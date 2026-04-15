from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field

LABEL_NAMES = {0: "Normal", 1: "IR", 2: "OR", 3: "Ball"}
NUM_CLASSES = 4
INPUT_SIZE = 1024


class FLConfig(BaseModel):
    # ── Data ──────────────────────────────────────────────
    num_clients: int = Field(4, ge=2, le=20)
    partition_strategy: Literal["iid", "dirichlet", "by_load"] = "iid"
    dirichlet_alpha: float = Field(0.5, gt=0.0, le=100.0)

    # ── Federated Learning ────────────────────────────────
    num_rounds: int = Field(10, ge=1, le=100)
    fraction_fit: float = Field(1.0, gt=0.0, le=1.0)
    aggregation_strategy: Literal["fedavg", "fedprox", "fednova", "fedbn"] = "fedavg"
    fedprox_mu: float = Field(0.01, ge=0.0, le=10.0)
    early_stopping_patience: int = Field(0, ge=0, le=20)  # rounds without improvement; 0 = disabled

    # ── Local Training ────────────────────────────────────
    local_epochs: int = Field(3, ge=1, le=20)
    batch_size: int = Field(64, ge=8, le=512)
    learning_rate: float = Field(0.001, gt=0.0)
    optimizer: Literal["adam", "sgd", "adamw"] = "adam"
    lr_scheduler: Literal["none", "step", "cosine", "warmup_cosine"] = "none"
    weight_decay: float = Field(1e-4, ge=0.0)
    grad_clip: float = Field(1.0, ge=0.0)         # max gradient norm; 0 = disabled
    label_smoothing: float = Field(0.0, ge=0.0, le=0.3)
    use_augmentation: bool = False
    aug_noise_std: float = Field(0.01, ge=0.0, le=1.0)  # std of Gaussian noise added to inputs

    # ── Model ─────────────────────────────────────────────
    model_type: Literal["cnn1d", "resnet1d", "lstm1d", "tcn"] = "cnn1d"
    dropout: float = Field(0.3, ge=0.0, le=0.9)

    seed: int = 42
