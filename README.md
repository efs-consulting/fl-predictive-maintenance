# fl-predictive-maintenance

A collection of federated learning experiments for predictive maintenance. Each sub-project targets a different asset type or fault domain. Clients train on local sensor data and share only model weights — never raw signals — with a central aggregation server.

---

## Sub-projects

| Directory | Asset | Dataset | Status |
|---|---|---|---|
| [`Bearing Fault/`](Bearing%20Fault/README.md) | Rolling-element bearings | CWRU 12 kHz drive-end vibration | Active |

---

## Repository Layout

```
fl-predictive-maintenance/
├── Bearing Fault/      # BearingFL — bearing fault diagnosis dashboard
└── ...                 # future sub-projects
```

Each sub-project is self-contained: it has its own dependencies, virtual environment, data directory, and README with full setup instructions.

---

## Common Concepts

All sub-projects share the same federated learning paradigm:

- **No raw data sharing** — clients send weight updates only
- **Pluggable aggregation** — FedAvg, FedProx, FedNova, FedBN
- **Heterogeneous data support** — IID, Dirichlet non-IID, and condition-based partitioning
- **Live monitoring** — real-time metrics streamed to a browser dashboard via WebSocket

---

## Getting Started

Navigate into the sub-project you want to run and follow its README.

```bash
cd "Bearing Fault"
# then follow Bearing Fault/README.md
```
