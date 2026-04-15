from __future__ import annotations
import time
import torch
from torch.utils.data import DataLoader
from sklearn.metrics import confusion_matrix as sk_cm, precision_recall_fscore_support
import numpy as np

from config import NUM_CLASSES


def compute_confusion_matrix(model: torch.nn.Module, loader: DataLoader, device: torch.device) -> list[list[int]]:
    model.eval()
    all_preds, all_labels = [], []
    with torch.no_grad():
        for X, y in loader:
            X = X.to(device)
            preds = model(X).argmax(1).cpu().numpy()
            all_preds.extend(preds.tolist())
            all_labels.extend(y.numpy().tolist())
    cm = sk_cm(all_labels, all_preds, labels=list(range(NUM_CLASSES)))
    return cm.tolist()


def benchmark_model(
    model: torch.nn.Module,
    loader: DataLoader,
    device: torch.device,
) -> dict:
    """Full evaluation suite used by the Benchmark tab.
    Returns accuracy, loss, per-class precision/recall/F1/accuracy,
    confusion matrix, and wall-clock inference time."""
    model.eval()
    criterion = torch.nn.CrossEntropyLoss()
    all_preds, all_labels = [], []
    total_loss, total = 0.0, 0

    t0 = time.perf_counter()
    with torch.no_grad():
        for X, y in loader:
            X, y = X.to(device), y.to(device)
            logits = model(X)
            total_loss += criterion(logits, y).item() * len(y)
            preds = logits.argmax(1).cpu().numpy()
            all_preds.extend(preds.tolist())
            all_labels.extend(y.cpu().numpy().tolist())
            total += len(y)
    elapsed_ms = (time.perf_counter() - t0) * 1000

    all_preds  = np.array(all_preds)
    all_labels = np.array(all_labels)
    accuracy   = float((all_preds == all_labels).mean())
    loss       = total_loss / max(total, 1)

    cm = sk_cm(all_labels, all_preds, labels=list(range(NUM_CLASSES)))
    per_class_acc = (cm.diagonal() / cm.sum(axis=1).clip(min=1)).tolist()

    precision, recall, f1, _ = precision_recall_fscore_support(
        all_labels, all_preds,
        labels=list(range(NUM_CLASSES)),
        zero_division=0,
    )

    return {
        "accuracy":            round(accuracy, 6),
        "loss":                round(loss, 6),
        "per_class_accuracy":  [round(float(v), 4) for v in per_class_acc],
        "per_class_precision": [round(float(v), 4) for v in precision],
        "per_class_recall":    [round(float(v), 4) for v in recall],
        "per_class_f1":        [round(float(v), 4) for v in f1],
        "confusion_matrix":    cm.tolist(),
        "inference_time_ms":   round(elapsed_ms, 1),
        "total_samples":       total,
    }


def evaluate_global(model: torch.nn.Module, loader: DataLoader, device: torch.device) -> tuple[float, float]:
    model.eval()
    criterion = torch.nn.CrossEntropyLoss()
    total_loss, correct, total = 0.0, 0, 0
    with torch.no_grad():
        for X, y in loader:
            X, y = X.to(device), y.to(device)
            logits = model(X)
            total_loss += criterion(logits, y).item() * len(y)
            correct += (logits.argmax(1) == y).sum().item()
            total += len(y)
    return total_loss / max(total, 1), correct / max(total, 1)
