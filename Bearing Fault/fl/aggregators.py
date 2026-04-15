from __future__ import annotations
import copy
import torch


def fedavg(
    client_weights: list[dict],
    sample_counts: list[int],
) -> dict:
    """Weighted average of model weights by number of local training samples."""
    total = sum(sample_counts)
    base = copy.deepcopy(client_weights[0])

    for key in base:
        base[key] = torch.zeros_like(base[key], dtype=torch.float32)
        for w, n in zip(client_weights, sample_counts):
            base[key] += (n / total) * w[key].float()

    return base


def fedprox(
    client_weights: list[dict],
    sample_counts: list[int],
    global_weights: dict,   # kept for API symmetry; proximal term is handled client-side
    mu: float,
) -> dict:
    """FedProx server aggregation is identical to FedAvg.
    The proximal term mu * ||w - w_global||^2 is added in the client loss."""
    return fedavg(client_weights, sample_counts)


def fedbn(
    client_weights: list[dict],
    sample_counts: list[int],
) -> dict:
    """FedBN: aggregate all layers EXCEPT BatchNorm running statistics.
    BN stats stay local, preserving client-specific feature distributions
    which is helpful under non-IID data."""
    total = sum(sample_counts)
    base = copy.deepcopy(client_weights[0])

    for key in base:
        # Skip BN running statistics — these remain per-client
        if any(tag in key for tag in ('running_mean', 'running_var', 'num_batches_tracked')):
            continue
        base[key] = torch.zeros_like(base[key], dtype=torch.float32)
        for w, n in zip(client_weights, sample_counts):
            base[key] += (n / total) * w[key].float()

    return base


def fednova(
    client_weights: list[dict],
    sample_counts: list[int],
    local_steps: list[int],
    global_weights: dict,
    lr_server: float = 1.0,
) -> dict:
    """Normalised averaging that corrects for heterogeneous local update counts."""
    total = sum(sample_counts)
    aggregated_delta = None

    for w_local, n, tau in zip(client_weights, sample_counts, local_steps):
        if tau == 0:
            tau = 1
        weight = n / total
        for key in w_local:
            delta = (global_weights[key].float() - w_local[key].float()) / tau
            if aggregated_delta is None:
                aggregated_delta = {k: torch.zeros_like(v, dtype=torch.float32)
                                    for k, v in w_local.items()}
            aggregated_delta[key] += weight * delta

    new_global = copy.deepcopy(global_weights)
    for key in new_global:
        new_global[key] = global_weights[key].float() - lr_server * aggregated_delta[key]

    return new_global
