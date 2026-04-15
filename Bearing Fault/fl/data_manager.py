from __future__ import annotations
from dataclasses import dataclass, field
from typing import List

import numpy as np
import pandas as pd
import torch
from torch.utils.data import DataLoader, TensorDataset
from sklearn.model_selection import train_test_split

import settings
from config import FLConfig, NUM_CLASSES


@dataclass
class ClientDataset:
    client_id: int
    X_train: np.ndarray
    y_train: np.ndarray
    X_val: np.ndarray
    y_val: np.ndarray

    def to_torch_loaders(self, batch_size: int) -> tuple[DataLoader, DataLoader]:
        def _make_loader(X, y, shuffle):
            Xt = torch.tensor(X, dtype=torch.float32)
            yt = torch.tensor(y, dtype=torch.long)
            return DataLoader(TensorDataset(Xt, yt), batch_size=batch_size, shuffle=shuffle)

        return (
            _make_loader(self.X_train, self.y_train, shuffle=True),
            _make_loader(self.X_val, self.y_val, shuffle=False),
        )

    @property
    def num_train(self) -> int:
        return len(self.y_train)

    @property
    def class_counts(self) -> dict:
        counts = {i: 0 for i in range(NUM_CLASSES)}
        for lbl in self.y_train:
            counts[int(lbl)] += 1
        return counts


class DataManager:
    def __init__(self) -> None:
        X_raw = np.load(settings.DATA_DIR / "X.npy").astype(np.float32)
        self.y = np.load(settings.DATA_DIR / "y.npy").astype(np.int64)
        self.meta = pd.read_csv(settings.DATA_DIR / "meta.csv")

        # Per-sample z-score normalisation
        mu = X_raw.mean(axis=1, keepdims=True)
        sigma = X_raw.std(axis=1, keepdims=True) + 1e-8
        self.X = (X_raw - mu) / sigma

    # ── public API ──────────────────────────────────────────────────────────
    def split_global_test(self, test_ratio: float = 0.10, seed: int = 42):
        """Reserve a global held-out test set before any client partitioning."""
        idx = np.arange(len(self.y))
        train_idx, test_idx = train_test_split(
            idx, test_size=test_ratio, stratify=self.y, random_state=seed
        )
        return train_idx, test_idx

    def partition(self, config: FLConfig, train_idx: np.ndarray) -> List[ClientDataset]:
        rng = np.random.default_rng(config.seed)
        strategy = config.partition_strategy
        n = config.num_clients

        if strategy == "iid":
            shards = self._iid(train_idx, n, rng)
        elif strategy == "dirichlet":
            shards = self._dirichlet(train_idx, n, config.dirichlet_alpha, rng)
        else:  # by_load
            shards = self._by_load(train_idx, n)

        datasets = []
        for cid, shard in enumerate(shards):
            if len(shard) < 2:
                shard = train_idx[: max(10, len(train_idx) // n)]
            X_c, y_c = self.X[shard], self.y[shard]
            X_tr, X_vl, y_tr, y_vl = train_test_split(
                X_c, y_c, test_size=0.20, stratify=y_c if len(np.unique(y_c)) > 1 else None,
                random_state=config.seed,
            )
            datasets.append(ClientDataset(cid, X_tr, y_tr, X_vl, y_vl))
        return datasets

    def get_test_loader(self, test_idx: np.ndarray, batch_size: int = 256) -> DataLoader:
        Xt = torch.tensor(self.X[test_idx], dtype=torch.float32)
        yt = torch.tensor(self.y[test_idx], dtype=torch.long)
        return DataLoader(TensorDataset(Xt, yt), batch_size=batch_size, shuffle=False)

    def distribution_summary(self, datasets: List[ClientDataset]) -> list:
        summary = []
        for ds in datasets:
            summary.append(
                {
                    "client_id": ds.client_id,
                    "total": ds.num_train,
                    "class_counts": {str(k): v for k, v in ds.class_counts.items()},
                }
            )
        return summary

    # ── partition strategies ─────────────────────────────────────────────────
    def _iid(self, idx: np.ndarray, n: int, rng) -> list[np.ndarray]:
        shuffled = rng.permutation(idx)
        return np.array_split(shuffled, n)

    def _dirichlet(self, idx: np.ndarray, n: int, alpha: float, rng) -> list[np.ndarray]:
        labels = self.y[idx]
        client_shards: list[list] = [[] for _ in range(n)]

        for cls in range(NUM_CLASSES):
            cls_idx = idx[labels == cls]
            if len(cls_idx) == 0:
                continue
            proportions = rng.dirichlet(alpha * np.ones(n))
            proportions = proportions / proportions.sum()
            splits = (proportions * len(cls_idx)).astype(int)
            # Fix rounding so sum == len(cls_idx)
            splits[-1] = len(cls_idx) - splits[:-1].sum()
            splits = np.maximum(splits, 0)
            rng.shuffle(cls_idx)
            ptr = 0
            for cid, cnt in enumerate(splits):
                client_shards[cid].extend(cls_idx[ptr : ptr + cnt].tolist())
                ptr += cnt

        return [np.array(s) for s in client_shards]

    def _by_load(self, idx: np.ndarray, n: int) -> list[np.ndarray]:
        loads = self.meta["load"].values[idx]
        unique_loads = sorted(set(loads))
        shards: list[list] = [[] for _ in range(n)]
        for i, load_val in enumerate(unique_loads):
            cid = i % n
            shards[cid].extend(idx[loads == load_val].tolist())
        # Fill empty shards with a random sample
        non_empty = [s for s in shards if s]
        for i, s in enumerate(shards):
            if not s:
                shards[i] = list(np.random.choice(non_empty[0], size=min(50, len(non_empty[0]))))
        return [np.array(s) for s in shards]
