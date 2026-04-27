# BearingFL — Federated Learning Dashboard for Bearing Fault Diagnosis

A browser-based dashboard for training, evaluating, and deploying federated learning models on the CWRU bearing vibration dataset. Supports four model architectures, four aggregation strategies, real-time training monitoring via WebSocket, multi-model ensemble inference, PDF report generation, and a session-aware AI assistant.

---

![Dashboard screenshot](image-1.png)

## Table of Contents

1. [Overview](#overview)
2. [Project Structure](#project-structure)
3. [Dataset](#dataset)
4. [Models](#models)
5. [Federated Learning](#federated-learning)
6. [Training Settings](#training-settings)
7. [Dashboard Pages](#dashboard-pages)
8. [Session Tracking](#session-tracking)
9. [PDF Reports](#pdf-reports)
10. [Technical Glossary & User Manual](#technical-glossary--user-manual)
11. [AI Assistant](#ai-assistant)
12. [API Reference](#api-reference)
13. [Setup & Running](#setup--running)
14. [Environment Variables](#environment-variables)
15. [Requirements](#requirements)

---

## Overview

BearingFL simulates a federated learning system locally — multiple clients each hold a private shard of the CWRU bearing dataset, train local models, and send only model weights (never raw data) to a central server for aggregation. The global model is evaluated after every communication round on a held-out test set, and all metrics are streamed live to the browser via WebSocket.

**Key capabilities**

| Feature | Details |
|---|---|
| Model architectures | CNN1D · ResNet1D · BiLSTM · TCN |
| FL aggregation strategies | FedAvg · FedProx · FedNova · FedBN |
| Data partitioning | IID · Non-IID Dirichlet · By load condition |
| Simulated clients | 2 – 20 |
| Communication rounds | 1 – 100 |
| Inference | Single signal or file upload; single or ensemble of saved models |
| Benchmarking | Side-by-side metric comparison across saved models |
| Session tracking | Full history of all runs, predictions, and benchmarks persisted across page navigations |
| PDF reports | One-click report generation from the complete session history |
| AI assistant | In-browser chatbot with full session context awareness; powered by LM Studio or Claude |
| Tooltips | Hover any parameter label for an instant definition |
| Technical glossary | Searchable, categorised glossary of all FL and signal-processing terms |
| User manual | Built-in guide covering all workflows and data formats |

---

## Project Structure

```
Bearing Fault/
├── main.py               # FastAPI application — REST endpoints, WebSocket, chat proxy
├── settings.py           # Runtime settings loaded from environment / .env
├── config.py             # FLConfig Pydantic model and training constants
├── run.sh                # Local launch script (activates venv, starts uvicorn)
├── requirements.txt      # Python dependencies
├── Dockerfile            # Docker image definition
├── docker-compose.yml    # Docker Compose — api + nginx services
├── .env                  # Environment variables (not committed)
├── get_data.py           # Downloads and pre-processes the CWRU dataset
│
├── fl/
│   ├── models.py         # CNN1D, ResNet1D, LSTM1D (BiLSTM), TCN, build_model()
│   ├── aggregators.py    # fedavg, fedprox, fedbn, fednova
│   ├── client.py         # ClientTrainer — local training loop
│   ├── server.py         # FLServer — orchestrates rounds, saves checkpoints
│   ├── data_manager.py   # DataManager — partitioning strategies and data loaders
│   └── metrics.py        # evaluate_global, benchmark_model, confusion matrix
│
├── static/
│   ├── index.html        # Home / Demo page
│   ├── training.html     # Training configuration and live monitoring
│   ├── prediction.html   # Single-signal inference page
│   ├── benchmark.html    # Multi-model comparison page
│   ├── css/
│   │   └── style.css     # All styles (dark theme, charts, modals, tooltips)
│   └── js/
│       ├── app.js        # Core frontend — WebSocket, session tracking, chat, API calls
│       ├── report.js     # PDF report generation (jsPDF + jsPDF-autoTable)
│       ├── guide.js      # Technical glossary modal — terms and search
│       ├── manual.js     # User manual modal — full in-app documentation
│       ├── tooltip.js    # Shared tooltip controller (data-tooltip attributes)
│       └── demo.js       # Home-page demo animations
│
├── nginx/
│   └── nginx.conf        # Reverse proxy configuration
│
├── models/               # Saved model checkpoints (created at runtime)
│   └── index.json        # Model library metadata
│
└── data/                 # Pre-processed dataset files (created by get_data.py)
    ├── X.npy             # Signal windows  (N × 1024, float32)
    ├── y.npy             # Labels          (N,  int64)
    └── meta.csv          # Sample metadata (load condition, fault diameter, etc.)
```

---

## Dataset

**CWRU Bearing Dataset** — Case Western Reserve University

| Property | Value |
|---|---|
| Total samples | ~14,377 |
| Signal length | 1024 samples per window |
| Sampling rate | 12 kHz (drive-end accelerometer) |
| Classes | 4 |
| Preprocessing | Per-sample z-score normalisation |

**Fault classes**

| ID | Label | Description |
|---|---|---|
| 0 | Normal | Healthy bearing — no seeded fault |
| 1 | IR | Inner race fault |
| 2 | OR | Outer race fault |
| 3 | Ball | Rolling element (ball) fault |

A 10 % stratified split (seed = 42) is held out as the global test set before any client partitioning. This same split is always used for benchmarking, ensuring a fair comparison across models.

To download and preprocess the dataset:

```bash
python get_data.py
```

---

## Models

All models accept a raw 1-D vibration window of length 1024 and output 4-class logits. Inputs are z-score normalised before inference.

### CNN1D
Four progressively downsampling 1-D convolutional layers (channels 1→16→32→64→128) with BatchNorm and ReLU, followed by adaptive average pooling to 16 steps and two fully-connected layers (256 → 4).

### ResNet1D
A stem layer (conv7 + MaxPool) followed by three residual stages (64 → 128 → 256 channels) using `BasicBlock1D` with skip connections. Global adaptive average pooling and a single linear head. Deeper representations generally yield higher accuracy.

### BiLSTM (`lstm1d`)
A CNN front-end (two conv layers: 1→32→64, stride 4 then 2) compresses 1024 time steps to ~128. A two-layer bidirectional LSTM (hidden = 128, 256 total features) processes the sequence. The last hidden state is fed into a linear classification head.

### TCN
Four `TCNBlock` residual blocks with exponentially growing dilations (1 → 2 → 4 → 8), channels 1→32→64→128→128, kernel size 5, GELU activations. Global adaptive average pooling followed by a linear head. Captures long-range temporal dependencies efficiently.

---

## Federated Learning

### Aggregation Strategies

| Strategy | Description |
|---|---|
| **FedAvg** | Weighted average of client weights, proportional to each client's number of training samples. |
| **FedProx** | Identical server aggregation to FedAvg, but adds a proximal term `μ ∥w − w_global∥²` to each client's loss, limiting client drift under heterogeneous data. |
| **FedNova** | Normalised averaging that divides each client's update by its local gradient step count, correcting for unequal local training effort. |
| **FedBN** | FedAvg but skips aggregation of BatchNorm running statistics (`running_mean`, `running_var`, `num_batches_tracked`). Each client keeps its own BN statistics, improving performance under feature shift. |

### Data Partitioning Strategies

| Strategy | Description |
|---|---|
| **IID** | Training indices are shuffled and split uniformly. Each client sees a representative class distribution. |
| **Non-IID Dirichlet** | Class proportions are drawn from a Dirichlet(α) distribution. Low α (e.g. 0.1) creates highly skewed, heterogeneous clients; high α (e.g. 100) approaches IID. |
| **By Load** | Samples are grouped by motor load condition (from `meta.csv`) and assigned round-robin. Simulates realistic deployments where each machine operates under a fixed load. |

### Communication Round

1. The server randomly selects `ceil(fraction_fit × num_clients)` clients.
2. Selected clients receive the current global weights and run `local_epochs` of local training.
3. Updated weights are returned to the server and aggregated according to the chosen strategy.
4. The global model is evaluated on the held-out test set; metrics are broadcast via WebSocket.
5. If `early_stopping_patience > 0` and global accuracy has not improved for that many rounds, training halts automatically.
6. On completion, the global model is saved to `models/` with full metadata.

---

## Training Settings

All settings are configurable from the Training page.

### Data Partitioning

| Setting | Range / Options | Default |
|---|---|---|
| Number of Clients | 2 – 20 | 4 |
| Partition Strategy | IID · Dirichlet · By Load | IID |
| Dirichlet α | 0.05 – 10.0 | 0.5 |

### Federated Learning

| Setting | Range / Options | Default |
|---|---|---|
| Rounds | 1 – 100 | 10 |
| Fraction Fit | 0.1 – 1.0 | 1.0 |
| Aggregation Strategy | FedAvg · FedProx · FedNova · FedBN | FedAvg |
| FedProx μ | 0.0001 – 1.0 | 0.01 |
| Early Stopping Patience | 0 – 20 (0 = disabled) | 0 |

### Local Training

| Setting | Range / Options | Default |
|---|---|---|
| Local Epochs | 1 – 20 | 3 |
| Batch Size | 16 · 32 · 64 · 128 · 256 | 64 |
| Learning Rate | 0.1 · 0.01 · 0.001 · 0.0001 | 0.001 |
| Optimizer | Adam · SGD · AdamW | Adam |
| LR Scheduler | None · StepLR (γ=0.9) · Cosine · Warmup+Cosine | None |
| Weight Decay | 0 · 1e-4 · 1e-3 · 1e-2 | 1e-4 |
| Gradient Clipping | 0.0 – 5.0 (0 = off) | 1.0 |
| Label Smoothing | 0.00 – 0.30 | 0.00 |
| Data Augmentation | Gaussian noise added to inputs | Off |
| Noise Std Dev | 0.001 – 0.500 | 0.010 |

### Model Architecture

| Setting | Options | Default |
|---|---|---|
| Model Type | CNN1D · ResNet1D · BiLSTM · TCN | CNN1D |
| Dropout | 0.00 – 0.90 | 0.30 |
| Random Seed | 0 – 99999 | 42 |

---

## Dashboard Pages

The application is a four-page dashboard. All pages share a common header with navigation, a PDF report button, a User Manual button, and a Technical Glossary button.

### Home (`/`)
Landing page with an animated overview of the federated learning workflow: data partitioning → local training → aggregation → evaluation. Provides quick links to training, prediction, and benchmarking.

### Training (`/training.html`)
Full training configuration and live monitoring.

- **Configuration panel** — all FL and local training settings via a modal dialog; a chip summary is shown once confirmed
- **Live charts** — global accuracy and loss curves updated every round (Chart.js)
- **Client table** — per-client train accuracy, validation accuracy, and sample count per round
- **Confusion matrix** — rendered after training completes
- **Event log** — timestamped INFO / SUCCESS / WARNING messages streamed from the backend
- **Progress bar** — shows current round out of total rounds

### Prediction (`/prediction.html`)
Run inference on a vibration signal using one or more saved models.

- **Signal input** (three methods):
  - Paste raw comma-separated float values
  - Upload a `.npy` file or plain-text file (one value per line)
  - Fetch a random sample from the dataset, optionally filtered by fault class
- **Model selection** — choose any combination of saved models from the library
- **Results**:
  - Per-model prediction card with fault class, confidence, and full 4-class probability bar chart
  - Ensemble result (majority vote + averaged probabilities) when multiple models are selected
  - Window-by-window breakdown table

### Benchmark (`/benchmark.html`)
Compare saved models side-by-side on the same held-out test set (seed = 42).

- **Summary table** — accuracy, loss, macro F1, macro precision, macro recall, inference time (ms), parameter count
- **Accuracy** horizontal bar chart
- **Inference time** bar chart
- **Radar chart** — accuracy, F1, precision, and recall per model on one chart
- **Per-class accuracy** grouped bar chart
- **Macro F1** grouped bar chart
- **Confusion matrix** per model

---

## Session Tracking

BearingFL automatically records every action across the entire session and persists the data in `localStorage` so it survives page navigation and browser restarts.

**What is tracked:**

| Category | Stored data |
|---|---|
| Training runs | Full configuration (all 20 settings), round-by-round accuracy/loss, best accuracy, final loss, confusion matrix, per-client validation accuracy, saved model ID |
| Predictions | Input source, true label (if sample), ensemble result with full 4-class probabilities, vote breakdown, per-model predictions |
| Benchmarks | All model metrics — accuracy, loss, F1/precision/recall (macro and per-class), inference time, parameter count |

The session badge on the Report button shows a summary of accumulated data. The **Clear Session** button in the report dialog resets all tracked history.

---

## PDF Reports

Click the **Report** button in the header on any page to generate a PDF summarising the current session.

The report includes:
- Session metadata (date, duration)
- Summary table of all completed training runs with configuration and results
- Confusion matrix images for each completed run
- Summary of all predictions made
- Benchmark comparison tables with per-class breakdowns

Report generation uses [jsPDF](https://github.com/parallax/jsPDF) and [jsPDF-AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable) entirely in the browser — no data is sent to the server.

---

## Technical Glossary & User Manual

### Technical Glossary
Click the **Glossary** button in the header to open the searchable technical glossary. It contains definitions for all FL algorithms, data partitioning strategies, model architectures, evaluation metrics, fault types, and inference concepts. Hover any term name to see its one-line definition as a tooltip.

### User Manual
Click the **Manual** button in the header to open the full in-app user manual. It covers:
- Supported data formats (CWRU built-in and custom signal files)
- Step-by-step training guide with recommended configurations
- Prediction workflow — all three input methods
- Benchmarking — how to interpret charts and metrics
- Report generation
- AI assistant usage and tips

Both the glossary and manual are rendered entirely in the browser from JavaScript; no server request is needed.

---

## AI Assistant

An in-browser chatbot is available via the circular button in the bottom-right corner of every page. It is aware of the full session history and can answer questions about your specific training runs, predictions, and benchmark results.

### Session context
Every message sent to the assistant includes a structured summary of the current session:
- All training run configurations and results (accuracy, loss, confusion matrix, client metrics, training curve)
- All predictions with full probability distributions and correctness
- All benchmark results with per-class metrics for every model

This means you can ask questions like:
- *"Why did my Ball fault accuracy drop compared to Run 1?"*
- *"Which model had the fastest inference time in the benchmark?"*
- *"Was my last prediction correct?"*
- *"How could I improve my FedProx run?"*

### Backend priority

The assistant uses the following priority order:

1. **LM Studio** (primary) — OpenAI-compatible streaming endpoint. Set `LM_STUDIO_BASE_URL` and `LM_STUDIO_API_KEY` in `.env`. Supports any model hosted by LM Studio including reasoning models (Gemma, Qwen, Kimi).
2. **Anthropic Claude** (fallback) — Used when LM Studio is unreachable. Set `ANTHROPIC_API_KEY` in `.env`. Uses `claude-haiku-4-5` for fast responses.
3. **Setup message** — If neither key is configured, the assistant returns a setup prompt instead of an AI response.

### Reasoning model support
Models with chain-of-thought reasoning (e.g. Gemma 4, Qwen3, Kimi K2) are fully supported. The backend requests `enable_thinking: false` where supported and sets a generous `max_tokens: 2500` to allow the reasoning phase to complete. Actual answer content is preferred over raw reasoning output.

### Conversation history
The last 10 exchanges are sent with every request for multi-turn context. The session summary is appended to the system prompt so the model always has full awareness of what has been done.

---

## API Reference

### Health & Config

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Returns `{"status":"ok","training":bool}` |
| `GET` | `/api/config/defaults` | Returns default `FLConfig` values |

### Model Library

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/models` | List all saved models with metadata |
| `DELETE` | `/api/models/{model_id}` | Delete a model and its checkpoint file |

### Inference

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/predict` | JSON body: `{signal: float[], model_ids: str[]}` |
| `POST` | `/api/predict/upload` | Multipart form: `file` (`.npy` or plain text) + `model_ids` |
| `GET` | `/api/predict/sample` | Random sample from dataset; optional `?class_id=0..3` |

### Benchmark

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/benchmark` | JSON body: `{model_ids: str[]}` (max 12). Evaluates all on the same seed=42 test split. |

### Training

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/train` | Start a training run. Body: full `FLConfig` JSON. |
| `POST` | `/api/stop` | Cancel the currently running training task. |

### Chat

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/api/chat` | `{message, history, session_context}` | Send a message to the AI assistant. `session_context` is a plain-text session summary built by the frontend and appended to the system prompt. |

### WebSocket

| Path | Description |
|---|---|
| `/ws` | Real-time event stream during training (proxied by nginx in Docker). |

**WebSocket message types**

| Type | Sent when |
|---|---|
| `CONNECTED` | Client connects |
| `DATA_DISTRIBUTION` | After data is partitioned across clients |
| `ROUND_START` | Each round begins; includes the selected client IDs |
| `ROUND_COMPLETE` | Each round ends; includes global metrics and per-client stats |
| `TRAINING_COMPLETE` | All rounds finish; includes model ID, confusion matrix, best accuracy |
| `TRAINING_ERROR` | An unhandled exception occurred during training |
| `LOG` | Info / success / warning log messages |

---

## Setup & Running

### Docker Compose (recommended)

Docker Compose runs the FastAPI backend and an nginx reverse proxy together. This is the recommended way to run BearingFL.

**Prerequisites**
- Docker and Docker Compose installed
- Dataset files in `./data/` (see [Dataset](#dataset))

**1. Prepare the dataset**

```bash
# Run once to download and preprocess the CWRU data
docker compose run --rm api python get_data.py
```

**2. Configure environment variables**

Copy the example and fill in your values:

```bash
cp .env.example .env   # or edit .env directly
```

See [Environment Variables](#environment-variables) for all options.

**3. Start the services**

```bash
docker compose up --build
```

**4. Open the dashboard**

```
http://localhost
```

The API is accessible internally at `http://localhost:8001` for local development.

---

### Local Development (without Docker)

**Prerequisites**
- Python 3.10 or later
- Dataset files in `./data/`

**1. Create a virtual environment**

```bash
cd "Bearing Fault"
python -m venv venv
source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

**2. Configure `.env`**

```bash
cp .env.example .env
# Set LM_STUDIO_BASE_URL, LM_STUDIO_API_KEY, or ANTHROPIC_API_KEY
```

**3. Start the server**

```bash
./run.sh
# or manually:
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

**4. Open the dashboard**

```
http://localhost:8001
```

---

## Environment Variables

All variables are read from `.env` at startup (loaded via `python-dotenv`). Docker Compose also passes them via the `env_file` directive.

| Variable | Required | Description |
|---|---|---|
| `LM_STUDIO_BASE_URL` | No | Base URL of an OpenAI-compatible LM Studio endpoint (e.g. `https://your-host/v1`). Primary chat backend. |
| `LM_STUDIO_API_KEY` | No | API key for the LM Studio endpoint. |
| `LM_STUDIO_MODEL` | No | Model ID to use (default: `google/gemma-4-26b-a4b`). |
| `ANTHROPIC_API_KEY` | No | Anthropic API key. Used as fallback when LM Studio is unreachable. |
| `DATA_DIR` | No | Path to the dataset directory. Default: `./data`. Set automatically by Docker. |
| `MODELS_DIR` | No | Path where model checkpoints are saved. Default: `./models`. Set automatically by Docker. |
| `HOST` | No | Uvicorn bind address. Default: `0.0.0.0`. |
| `PORT` | No | Uvicorn port. Default: `8001`. |
| `LOG_LEVEL` | No | Log verbosity: `DEBUG` · `INFO` · `WARNING` · `ERROR`. Default: `INFO`. |
| `RELOAD` | No | Enable uvicorn hot-reload. Set to `true` for local development only. Default: `false`. |

**Example `.env`**

```dotenv
# Primary chat backend (LM Studio / OpenAI-compatible)
LM_STUDIO_BASE_URL=https://your-lm-studio-host/v1
LM_STUDIO_API_KEY=sk-your-key

# Fallback chat backend (Anthropic Claude)
ANTHROPIC_API_KEY=sk-ant-...

# Paths (Docker sets these automatically)
DATA_DIR=./data
MODELS_DIR=./models

# Server
LOG_LEVEL=INFO
PORT=8001
HOST=0.0.0.0
RELOAD=false
```

---

## Requirements

```
fastapi>=0.115
uvicorn[standard]>=0.29
websockets>=12.0
torch>=2.1
numpy>=1.26
pandas>=2.0
scikit-learn>=1.4
scipy>=1.12
aiofiles>=23.2
pydantic>=2.5
anthropic>=0.25
python-dotenv>=1.0
python-multipart>=0.0.9
httpx>=0.27.0
```

GPU acceleration is used automatically if a CUDA device is available (`torch.cuda.is_available()`). Models are saved and loaded to CPU for inference regardless of the training device.

**Frontend libraries** (loaded from CDN, no build step required)

| Library | Version | Purpose |
|---|---|---|
| Chart.js | 4.4.4 | Live training charts and benchmark visualisations |
| jsPDF | 2.5.1 | PDF report generation |
| jsPDF-AutoTable | 3.8.2 | Tables in PDF reports |
