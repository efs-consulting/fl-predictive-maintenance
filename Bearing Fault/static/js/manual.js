'use strict';

// ──────────────────────────────────────────────────────────────────────────────
//  BearingFL — User Manual
// ──────────────────────────────────────────────────────────────────────────────

const MANUAL = [
  // ────────────────────────────────────────────────────────────────────────────
  {
    id: 'intro',
    title: 'Introduction',
    subs: [
      {
        id: 'intro-what',
        title: 'What is BearingFL?',
        html: `
<p class="manual-p">
  <strong>BearingFL</strong> is a browser-based platform for training, evaluating, and deploying
  bearing fault detection models using <strong>Federated Learning (FL)</strong>. Instead of
  centralising raw vibration data, FL trains local models on each simulated "client" (machine
  or sensor node) and aggregates only the model weights on a central server — preserving data
  locality while benefiting from collective knowledge.
</p>
<p class="manual-p">
  The platform targets the four bearing conditions defined in the
  <strong>CWRU (Case Western Reserve University)</strong> benchmark dataset:
  <strong>Normal, Inner Race (IR), Outer Race (OR)</strong>, and <strong>Ball</strong> fault.
</p>
<div class="manual-box note">
  <span class="box-icon">ℹ</span>
  <div class="box-body">BearingFL is designed for engineers and researchers who want to explore
  federated learning for predictive maintenance — no prior FL expertise required.</div>
</div>`
      },
      {
        id: 'intro-pages',
        title: 'Application Pages',
        html: `
<table class="manual-table">
  <thead><tr><th>Page</th><th>Purpose</th></tr></thead>
  <tbody>
    <tr><td>Demo</td><td>Interactive overview of the platform and its capabilities. Start here.</td></tr>
    <tr><td>FL Training</td><td>Configure and run federated learning training sessions. Monitor live metrics, confusion matrix, and per-client performance.</td></tr>
    <tr><td>Prediction</td><td>Upload or paste a vibration signal and classify it using one or more saved models.</td></tr>
    <tr><td>Benchmark</td><td>Compare saved models side-by-side on the full test set with accuracy, F1, precision, recall, and per-class charts.</td></tr>
  </tbody>
</table>`
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  {
    id: 'data',
    title: 'Supported Data',
    subs: [
      {
        id: 'data-source',
        title: 'Built-in Dataset',
        html: `
<p class="manual-p">
  BearingFL ships with the <strong>CWRU Bearing Dataset</strong>, pre-loaded on the server.
  The dataset contains 1D vibration acceleration signals recorded from a drive-end bearing
  under four health conditions at multiple motor loads (0 – 3 HP).
</p>
<table class="manual-table">
  <thead><tr><th>Class</th><th>Label</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td>Normal</td><td>0</td><td>Healthy bearing — no seeded fault.</td></tr>
    <tr><td>Inner Race</td><td>1</td><td>Defect on the inner raceway (BPFI impacts).</td></tr>
    <tr><td>Outer Race</td><td>2</td><td>Defect on the outer raceway (BPFO impacts).</td></tr>
    <tr><td>Ball</td><td>3</td><td>Defect on a rolling element (BSF impacts).</td></tr>
  </tbody>
</table>
<div class="manual-box note">
  <span class="box-icon">ℹ</span>
  <div class="box-body">Signals were sampled at <strong>12,000 Hz</strong> (drive end) and
  <strong>48,000 Hz</strong> (fan end). The platform uses 1024-sample sliding windows
  (~85 ms at 12 kHz) with a 512-sample step (50 % overlap).</div>
</div>`
      },
      {
        id: 'data-custom',
        title: 'Using Your Own Signal Data',
        html: `
<p class="manual-p">
  You can supply your own vibration signals on the <strong>Prediction</strong> page.
  The signal must meet the following requirements:
</p>
<table class="manual-table">
  <thead><tr><th>Requirement</th><th>Specification</th></tr></thead>
  <tbody>
    <tr><td>Dimensionality</td><td>1D — a single channel of acceleration values</td></tr>
    <tr><td>Minimum length</td><td>1 024 samples (one full window)</td></tr>
    <tr><td>Recommended length</td><td>4 096 – 16 384 samples for multiple windows and a more reliable ensemble vote</td></tr>
    <tr><td>Unit</td><td>Vibration acceleration in gravitational units (g). Arbitrary units work too, but model accuracy may degrade if the scale differs greatly from CWRU training data.</td></tr>
    <tr><td>Sampling rate</td><td>Any — but models were trained on CWRU data at 12 kHz. Signals from significantly different rates may yield lower accuracy.</td></tr>
    <tr><td>Multi-channel</td><td>Not supported directly. Submit one channel at a time.</td></tr>
  </tbody>
</table>
<p class="manual-p">Accepted file formats and how to prepare them:</p>
<div class="manual-sub-title" style="margin-top:6px">Text / CSV files</div>
<p class="manual-p">
  <span class="manual-tag">.txt</span> <span class="manual-tag">.csv</span>
  One numeric value per line, or values separated by commas or spaces.
  Headers and empty lines are ignored automatically.
  Example (comma-separated):
  <code>0.0312, -0.0187, 0.0445, ...</code>
</p>
<div class="manual-sub-title">NumPy files</div>
<p class="manual-p">
  <span class="manual-tag">.npy</span>
  A 1D NumPy array of float32 or float64 values. Create it with:
  <code>np.save("signal.npy", signal_array)</code>
  where <code>signal_array.shape == (N,)</code> and N ≥ 1024.
</p>
<div class="manual-box warn">
  <span class="box-icon">⚠</span>
  <div class="box-body">
    <strong>Do not submit 2D arrays</strong> (e.g., multi-channel or spectrogram data).
    The model expects a flat 1D sequence of acceleration samples.
  </div>
</div>
<div class="manual-box tip">
  <span class="box-icon">💡</span>
  <div class="box-body">
    Use the <strong>Load Sample</strong> buttons on the Prediction page to see the expected
    signal format before supplying your own data. You can also copy the pasted values from
    the text area as a reference.
  </div>
</div>`
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  {
    id: 'training',
    title: 'Training a Model',
    subs: [
      {
        id: 'training-navigate',
        title: 'Step 1 — Navigate to FL Training',
        html: `
<ol class="manual-steps">
  <li>Click <strong>FL Training</strong> in the top navigation bar.</li>
  <li>The page shows a live dashboard with training controls on the left, metric charts in the centre, and a model library on the right.</li>
  <li>All settings must be configured <em>before</em> pressing Start Training — they cannot be changed mid-run.</li>
</ol>`
      },
      {
        id: 'training-fl',
        title: 'Step 2 — Configure Federated Learning Settings',
        html: `
<table class="manual-table">
  <thead><tr><th>Parameter</th><th>Range</th><th>Description & Guidance</th></tr></thead>
  <tbody>
    <tr>
      <td>Number of Clients</td><td>2 – 20</td>
      <td>Simulated edge nodes. More clients increases realism and training time. Start with <em>3–5</em> for quick experiments.</td>
    </tr>
    <tr>
      <td>Partition Strategy</td><td>IID / Dirichlet / By Load</td>
      <td>How data is split across clients. <em>IID</em> = balanced random split (easiest). <em>Dirichlet</em> = configurable heterogeneity. <em>By Load</em> = each client receives data from a specific motor load (most realistic).</td>
    </tr>
    <tr>
      <td>Dirichlet α</td><td>0.05 – 100</td>
      <td>Only active when Partition = Dirichlet. Small α (e.g. <em>0.1</em>) = very skewed, non-IID. Large α (e.g. <em>100</em>) ≈ IID. Use <em>0.3 – 0.5</em> for a realistic industrial scenario.</td>
    </tr>
    <tr>
      <td>Aggregation Strategy</td><td>FedAvg / FedProx / FedNova / FedBN</td>
      <td>
        <em>FedAvg</em>: simplest, works well with IID data.<br>
        <em>FedProx</em>: adds a proximal term to prevent client drift — best for highly non-IID data.<br>
        <em>FedNova</em>: corrects for unequal local steps — useful when clients train for different numbers of epochs.<br>
        <em>FedBN</em>: keeps batch-norm statistics local — good when clients have different operating conditions.
      </td>
    </tr>
    <tr>
      <td>FedProx μ</td><td>0.0 – 1.0</td>
      <td>Only active when Strategy = FedProx. Controls regularisation strength. Start at <em>0.01</em>; increase to <em>0.1</em> if clients diverge badly.</td>
    </tr>
    <tr>
      <td>Number of Rounds</td><td>1 – 100</td>
      <td>Each round = one full aggregation cycle. <em>10–20</em> rounds are usually enough to see convergence. Use <em>30–50</em> for high-accuracy targets.</td>
    </tr>
    <tr>
      <td>Fraction Fit</td><td>0.1 – 1.0</td>
      <td>Fraction of clients selected per round. <em>1.0</em> = all clients participate every round. Lower values reduce communication cost at the expense of some noise.</td>
    </tr>
    <tr>
      <td>Early Stopping Patience</td><td>0 (off) – 20</td>
      <td>Stop training automatically when validation accuracy has not improved for this many consecutive rounds. Set to <em>5–10</em> to avoid wasted computation.</td>
    </tr>
  </tbody>
</table>`
      },
      {
        id: 'training-local',
        title: 'Step 3 — Configure Local Training',
        html: `
<table class="manual-table">
  <thead><tr><th>Parameter</th><th>Range / Options</th><th>Description & Guidance</th></tr></thead>
  <tbody>
    <tr>
      <td>Model Type</td><td>CNN1D / ResNet1D / BiLSTM / TCN</td>
      <td>
        <em>CNN1D</em>: lightweight, fast, good baseline (~50 K params).<br>
        <em>ResNet1D</em>: deeper with skip connections, highest accuracy (~120 K params).<br>
        <em>BiLSTM</em>: CNN front-end + bidirectional LSTM, captures long-range temporal patterns (~90 K params).<br>
        <em>TCN</em>: dilated temporal convolutions, wide receptive field, fast convergence (~80 K params).
      </td>
    </tr>
    <tr>
      <td>Local Epochs</td><td>1 – 20</td>
      <td>Passes each client makes over its local data per round. <em>3–5</em> is a safe default. Too many epochs risk client drift.</td>
    </tr>
    <tr>
      <td>Batch Size</td><td>16 – 256</td>
      <td>Samples per gradient step. <em>32–64</em> works well. Smaller batches add gradient noise (regularisation); larger batches train faster.</td>
    </tr>
    <tr>
      <td>Learning Rate</td><td>0.0001 – 0.1</td>
      <td>Controls step size. <em>0.001</em> is a reliable starting point for Adam/AdamW. Use <em>0.01</em> for SGD.</td>
    </tr>
    <tr>
      <td>Optimizer</td><td>SGD / Adam / AdamW</td>
      <td><em>Adam</em>: adaptive LR, fast convergence, best for most cases. <em>AdamW</em>: Adam + decoupled weight decay, often better generalisation. <em>SGD</em>: slower but sometimes more stable long-term.</td>
    </tr>
    <tr>
      <td>LR Scheduler</td><td>None / Step / Cosine / Warmup-Cosine</td>
      <td>Reduces learning rate over time. <em>Cosine</em> or <em>Warmup-Cosine</em> generally performs best — the rate decreases smoothly to near zero by the final round.</td>
    </tr>
    <tr>
      <td>Weight Decay</td><td>0.0 – 0.1</td>
      <td>L2 regularisation. <em>0.0001 – 0.001</em> is typical. Use higher values if the model overfits small client datasets.</td>
    </tr>
    <tr>
      <td>Dropout</td><td>0.0 – 0.5</td>
      <td>Randomly zeros activations during training to prevent overfitting. <em>0.1 – 0.3</em> is a common range; use <em>0.0</em> for small datasets.</td>
    </tr>
    <tr>
      <td>Gradient Clipping</td><td>0.0 (off) – 10.0</td>
      <td>Caps gradient norm to prevent exploding gradients. <em>1.0</em> is a safe default for deep models.</td>
    </tr>
    <tr>
      <td>Label Smoothing</td><td>0.0 – 0.2</td>
      <td>Replaces hard class targets with soft distributions. <em>0.05 – 0.1</em> can improve calibration without hurting accuracy significantly.</td>
    </tr>
    <tr>
      <td>Data Augmentation</td><td>On / Off</td>
      <td>Adds Gaussian noise to training windows to improve robustness to sensor noise.</td>
    </tr>
    <tr>
      <td>Noise σ</td><td>0.001 – 0.1</td>
      <td>Standard deviation of the Gaussian noise when augmentation is enabled. <em>0.005 – 0.02</em> is a realistic sensor-noise range.</td>
    </tr>
    <tr>
      <td>Random Seed</td><td>any integer</td>
      <td>Set a fixed seed (e.g. <em>42</em>) to make experiments reproducible across runs.</td>
    </tr>
  </tbody>
</table>
<div class="manual-box tip">
  <span class="box-icon">💡</span>
  <div class="box-body">
    <strong>Recommended starter configuration (fast, ~2 min):</strong>
    3 clients · IID · FedAvg · 10 rounds · CNN1D · 3 epochs · LR 0.001 · Adam · Batch 64 · No augmentation.
  </div>
</div>
<div class="manual-box good">
  <span class="box-icon">✓</span>
  <div class="box-body">
    <strong>Recommended high-accuracy configuration (~10–20 min):</strong>
    5 clients · Dirichlet α=0.3 · FedProx μ=0.01 · 30 rounds · ResNet1D · 5 epochs · LR 0.001 · AdamW · Cosine scheduler · Batch 32 · Augmentation σ=0.01 · Early stop patience 5.
  </div>
</div>`
      },
      {
        id: 'training-run',
        title: 'Step 4 — Start and Monitor Training',
        html: `
<ol class="manual-steps">
  <li>Click <strong>Start Training</strong>. The server begins the FL simulation immediately. The button becomes disabled; use <strong>Stop Training</strong> to interrupt early.</li>
  <li>Watch the <strong>Loss curve</strong> — it should decrease steadily. A flat or rising loss after several rounds indicates the learning rate is too high or data heterogeneity is causing client drift.</li>
  <li>Watch the <strong>Accuracy curve</strong> and the <strong>Best Accuracy</strong> stat. These should increase. The dashed line marks the historical best.</li>
  <li>The <strong>Per-Client Accuracy</strong> chart shows how each simulated client is performing. Large gaps between clients suggest high data heterogeneity — consider FedProx or a lower α.</li>
  <li>The <strong>Log Console</strong> at the bottom shows round-by-round messages, including any warnings.</li>
  <li>When training completes, the <strong>Confusion Matrix</strong> is shown. Each row is a true class; each column is the predicted class. Diagonal = correct predictions.</li>
  <li>The trained model is automatically saved to the <strong>Model Library</strong> on the right side of the page.</li>
</ol>
<div class="manual-box warn">
  <span class="box-icon">⚠</span>
  <div class="box-body">
    Do not close or refresh the training tab mid-run. If you must navigate to another page,
    training continues on the server and the session data is preserved — but real-time chart
    updates will stop until you return to the Training page.
  </div>
</div>`
      },
      {
        id: 'training-model-library',
        title: 'Step 5 — Model Library',
        html: `
<p class="manual-p">
  Every completed training run saves a model to the <strong>Model Library</strong> panel.
  Each entry shows the model type, aggregation strategy, partition method, best validation
  accuracy, and the timestamp.
</p>
<ol class="manual-steps">
  <li>Click a model card to <strong>select</strong> it (highlighted in purple). Selected models are available for Prediction and Benchmark.</li>
  <li>Click <strong>Select All</strong> or <strong>Clear</strong> to manage selections in bulk.</li>
  <li>Click the <strong>trash icon</strong> on a model card to permanently delete it from the server.</li>
  <li>Click <strong>Open Predict tab</strong> in the green banner (shown after training) to jump directly to Prediction with the new model pre-selected.</li>
</ol>`
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  {
    id: 'prediction',
    title: 'Prediction & Testing',
    subs: [
      {
        id: 'pred-navigate',
        title: 'Step 1 — Navigate to Prediction',
        html: `
<ol class="manual-steps">
  <li>Click <strong>Prediction</strong> in the top navigation bar.</li>
  <li>The Model Library appears on the left. Select one or more models to use for inference. Using multiple models enables ensemble voting, which is more robust than a single model.</li>
</ol>`
      },
      {
        id: 'pred-input',
        title: 'Step 2 — Provide a Signal',
        html: `
<p class="manual-p">You have three ways to provide a vibration signal:</p>
<div class="manual-sub-title">Option A — Load a built-in sample</div>
<ol class="manual-steps">
  <li>Click one of the <strong>Normal / IR / OR / Ball</strong> buttons in the Signal Input panel. This loads a random signal from the test set for that class.</li>
  <li>The <strong>true label</strong> is displayed, so you can immediately evaluate model accuracy.</li>
  <li>The waveform is previewed in the chart below the input area.</li>
</ol>
<div class="manual-sub-title">Option B — Paste raw values</div>
<ol class="manual-steps">
  <li>Click inside the text area.</li>
  <li>Paste your vibration values as a comma-separated or space-separated list, or one value per line.</li>
  <li>The counter updates live. You need at least <strong>1 024 values</strong> before the Classify button activates.</li>
</ol>
<div class="manual-sub-title">Option C — Upload a file</div>
<ol class="manual-steps">
  <li>Click <strong>Upload File</strong> and select a <span class="manual-tag">.txt</span> <span class="manual-tag">.csv</span> or <span class="manual-tag">.npy</span> file.</li>
  <li>Text/CSV files are parsed and displayed in the waveform chart. NumPy files are sent directly to the server for processing.</li>
</ol>
<div class="manual-box tip">
  <span class="box-icon">💡</span>
  <div class="box-body">
    Longer signals produce <strong>more windows</strong> and therefore a more stable
    ensemble decision. A 16 384-sample signal produces ~30 windows with 50 % overlap,
    giving 30 votes per model before majority voting.
  </div>
</div>`
      },
      {
        id: 'pred-run',
        title: 'Step 3 — Classify and Interpret Results',
        html: `
<ol class="manual-steps">
  <li>Click <strong>Classify Signal</strong>. The server runs inference on all selected models simultaneously.</li>
  <li>Results appear in the panel below. If you submitted a sample with a known label, a green <em>True label</em> badge is shown at the top.</li>
</ol>
<div class="manual-sub-title">Single-model result</div>
<p class="manual-p">
  Shows the <strong>predicted class</strong>, its <strong>confidence percentage</strong>,
  and the trained accuracy of that model. Below that, probability bars show the full
  class distribution — how strongly the model leans toward each class.
</p>
<div class="manual-sub-title">Multi-model ensemble result</div>
<p class="manual-p">
  When two or more models are selected, an <strong>Ensemble Decision</strong> banner appears
  at the top. It shows the winner class from majority voting and the vote breakdown
  (e.g. <em>IR: 2  OR: 1</em>). Below the ensemble, each model's individual prediction
  is shown in a grid.
</p>
<div class="manual-sub-title">Window breakdown</div>
<p class="manual-p">
  If a signal contains multiple windows (length > 1024), a collapsible table shows
  each window's prediction and confidence. This is useful for spotting intermittent faults
  that only appear in certain sections of the signal.
</p>
<div class="manual-box note">
  <span class="box-icon">ℹ</span>
  <div class="box-body">
    All predictions made during a session are saved and included in the
    <strong>PDF Report</strong>. The ensemble decision, true label, and per-model breakdown
    are all captured automatically.
  </div>
</div>`
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  {
    id: 'benchmark',
    title: 'Benchmarking',
    subs: [
      {
        id: 'bm-navigate',
        title: 'Step 1 — Navigate to Benchmark',
        html: `
<ol class="manual-steps">
  <li>Click <strong>Benchmark</strong> in the top navigation bar.</li>
  <li>The Model Library on the left shows all saved models. You need at least <strong>one model</strong> to run a benchmark; select at least <strong>two</strong> to see comparison charts.</li>
</ol>`
      },
      {
        id: 'bm-run',
        title: 'Step 2 — Run the Benchmark',
        html: `
<ol class="manual-steps">
  <li>Tick the checkboxes next to the models you want to compare.</li>
  <li>Click <strong>Run Benchmark</strong>. The server evaluates every selected model on the complete, fixed test set (seed = 42, never seen during training).</li>
  <li>Results appear in seconds to minutes, depending on the number of models and their size.</li>
</ol>
<div class="manual-box note">
  <span class="box-icon">ℹ</span>
  <div class="box-body">
    The benchmark always uses the same fixed test split so all models are evaluated
    identically and results are directly comparable.
  </div>
</div>`
      },
      {
        id: 'bm-results',
        title: 'Step 3 — Interpreting Results',
        html: `
<div class="manual-sub-title">Summary Table</div>
<p class="manual-p">One row per model, showing:</p>
<table class="manual-table">
  <thead><tr><th>Column</th><th>Meaning</th></tr></thead>
  <tbody>
    <tr><td>Accuracy</td><td>Overall fraction of correctly classified test samples. The primary ranking metric.</td></tr>
    <tr><td>Loss</td><td>Cross-entropy loss on the test set. Lower is better; use this to compare models that have the same accuracy.</td></tr>
    <tr><td>Avg F1</td><td>Macro-averaged F1 score across all four classes. Balances precision and recall; more informative than accuracy when classes are imbalanced.</td></tr>
    <tr><td>Avg Precision</td><td>Mean fraction of correct positive predictions across classes.</td></tr>
    <tr><td>Avg Recall</td><td>Mean fraction of actual positives correctly identified across classes. Critical for safety — a missed fault is more dangerous than a false alarm.</td></tr>
    <tr><td>Params</td><td>Total number of trainable model parameters. Smaller models are faster and cheaper to deploy.</td></tr>
    <tr><td>Time (ms)</td><td>Average inference time per batch on the server CPU. Important for real-time deployment requirements.</td></tr>
  </tbody>
</table>
<div class="manual-sub-title">Charts</div>
<table class="manual-table">
  <thead><tr><th>Chart</th><th>What to look for</th></tr></thead>
  <tbody>
    <tr><td>Overall Accuracy</td><td>Bar chart ranking models by accuracy. Use to pick the winner at a glance.</td></tr>
    <tr><td>Inference Time</td><td>Bar chart of per-batch latency. Choose a model with the best accuracy-to-latency ratio for your deployment target.</td></tr>
    <tr><td>Multi-Metric Radar</td><td>Spider chart showing Accuracy, F1, Precision, Recall, and Speed simultaneously. The larger the area, the better the overall model.</td></tr>
    <tr><td>Per-Class Accuracy</td><td>Grouped bars for Normal / IR / OR / Ball per model. Reveals class-specific weaknesses (e.g., Ball faults are typically the hardest to classify).</td></tr>
    <tr><td>Per-Class F1</td><td>Same breakdown but using F1 — accounts for both false positives and false negatives per class.</td></tr>
  </tbody>
</table>
<div class="manual-sub-title">Per-Model Confusion Matrices</div>
<p class="manual-p">
  Below the charts, a confusion matrix is shown for each model. Rows = true class,
  columns = predicted class. Darker blue = more samples in that cell.
  Diagonal cells highlighted with a border = correct predictions.
  Look for large off-diagonal values — they indicate which fault pairs the model confuses.
</p>
<div class="manual-box tip">
  <span class="box-icon">💡</span>
  <div class="box-body">
    <strong>Ball fault (class 3)</strong> is often the hardest to detect because its vibration
    signature is modulated and more complex. If a model scores poorly on Ball, try
    <em>ResNet1D</em>, a longer window size, or augmentation with higher noise σ.
  </div>
</div>`
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  {
    id: 'report',
    title: 'Generating Reports',
    subs: [
      {
        id: 'report-how',
        title: 'How to Generate a Report',
        html: `
<ol class="manual-steps">
  <li>The <strong>Report</strong> button is in the top-right corner of every page. Click it from any page at any time.</li>
  <li>The system first queries the AI service to write a structured analysis of your session. This takes 10 – 30 seconds depending on the LLM server load.</li>
  <li>The PDF is then built and automatically downloaded to your browser.</li>
</ol>`
      },
      {
        id: 'report-content',
        title: 'What the Report Contains',
        html: `
<table class="manual-table">
  <thead><tr><th>Section</th><th>Contents</th></tr></thead>
  <tbody>
    <tr><td>1 — Cover</td><td>Session summary: best accuracy, total training runs, predictions, FL rounds. Table of contents.</td></tr>
    <tr><td>2 — Configuration</td><td>Full parameter table for every training run in the session (FL settings + local training settings).</td></tr>
    <tr><td>3 — Training Results</td><td>Stat cards, loss/accuracy charts (from training page), round-by-round history table, and client metrics for every run.</td></tr>
    <tr><td>4 — Data & Evaluation</td><td>Data distribution chart and confusion matrix with per-class accuracy for every run.</td></tr>
    <tr><td>5 — Predictions</td><td>All predictions from the session — input source, true label, ensemble decision, per-model breakdown.</td></tr>
    <tr><td>6 — Benchmark</td><td>All benchmark runs — summary table, comparison charts, per-model confusion matrices.</td></tr>
    <tr><td>7 — AI Analysis</td><td>AI-generated structured assessment: convergence analysis, per-class insights, FL strategy evaluation, and recommendations.</td></tr>
  </tbody>
</table>
<div class="manual-box note">
  <span class="box-icon">ℹ</span>
  <div class="box-body">
    The report accumulates data across the <strong>entire session</strong> — all training runs,
    all predictions, and all benchmarks you have done since opening the application (or since
    the last Clear Session). Session data is stored in the browser's local storage and
    survives page navigation and browser restarts.
  </div>
</div>`
      },
      {
        id: 'report-clear',
        title: 'Clearing Session Data',
        html: `
<p class="manual-p">
  To start a fresh session (e.g., for a new experiment series), open the browser console
  (<code>F12</code> → Console tab) and run:
</p>
<p class="manual-p"><code>clearSession()</code></p>
<p class="manual-p">
  This resets the in-memory session and removes it from local storage. The next report
  will only contain activity performed after this call. Saved model files on the server
  are not affected.
</p>`
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  {
    id: 'ai-chat',
    title: 'AI Assistant',
    subs: [
      {
        id: 'ai-how',
        title: 'Using the AI Chat',
        html: `
<p class="manual-p">
  The <strong>AI Assistant</strong> button (bottom-right, chat bubble icon) opens a chat
  panel powered by the configured LLM service. The assistant automatically receives a full
  summary of your current session — all training runs, predictions, and benchmark results —
  so it can answer questions about <em>your specific experiments</em>, not just general FL theory.
</p>
<ol class="manual-steps">
  <li>Click the chat bubble icon in the bottom-right corner of any page.</li>
  <li>Type your question and press <strong>Enter</strong> or click <strong>Send</strong>.</li>
  <li>The assistant knows your current session data — you can ask things like <em>"Why is my IR recall low?"</em> or <em>"Which model should I deploy?"</em></li>
</ol>
<div class="manual-box tip">
  <span class="box-icon">💡</span>
  <div class="box-body">
    The assistant is aware of all experiments you have done in the current session.
    The more runs, predictions, and benchmarks you perform before asking, the more
    context it has to give you targeted advice.
  </div>
</div>
<div class="manual-box note">
  <span class="box-icon">ℹ</span>
  <div class="box-body">
    The AI service requires <code>LM_STUDIO_BASE_URL</code> and <code>LM_STUDIO_API_KEY</code>
    to be set in the server's <code>.env</code> file. If neither is configured, a fallback
    message is shown. Contact your system administrator if the chat is unavailable.
  </div>
</div>`
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────────
  {
    id: 'tips',
    title: 'Tips & Best Practices',
    subs: [
      {
        id: 'tips-workflow',
        title: 'Recommended Workflow',
        html: `
<ol class="manual-steps">
  <li><strong>Start simple.</strong> Use IID partitioning, FedAvg, CNN1D, and 10 rounds to get a fast baseline accuracy. This is your control experiment.</li>
  <li><strong>Introduce heterogeneity.</strong> Switch to Dirichlet α = 0.3 with the same settings. Compare the baseline accuracy drop — this tells you how sensitive your use case is to data heterogeneity.</li>
  <li><strong>Address heterogeneity.</strong> If accuracy drops significantly under non-IID, switch to FedProx (μ = 0.01) or FedBN (if feature distribution shift is the main issue).</li>
  <li><strong>Scale up.</strong> Once you have a working configuration, increase rounds to 30 – 50 and switch to ResNet1D for the highest accuracy.</li>
  <li><strong>Benchmark.</strong> Train 2–3 configurations and benchmark them together to pick the best model for deployment.</li>
  <li><strong>Generate a report.</strong> Document your findings with the PDF report before concluding the experiment session.</li>
</ol>`
      },
      {
        id: 'tips-tuning',
        title: 'Tuning Guidelines',
        html: `
<table class="manual-table">
  <thead><tr><th>Symptom</th><th>Likely Cause</th><th>Action</th></tr></thead>
  <tbody>
    <tr><td>Loss is rising or unstable</td><td>Learning rate too high</td><td>Reduce LR by 10×; add gradient clipping (1.0)</td></tr>
    <tr><td>Accuracy plateaus early</td><td>Too few rounds, LR too low</td><td>Increase rounds; try cosine scheduler</td></tr>
    <tr><td>Large accuracy gap between clients</td><td>High data heterogeneity</td><td>Use FedProx (μ = 0.01 – 0.1) or lower α</td></tr>
    <tr><td>Good training acc, poor test acc</td><td>Overfitting</td><td>Increase dropout, weight decay, or augmentation</td></tr>
    <tr><td>Ball class always misclassified</td><td>Complex BSF pattern</td><td>Use ResNet1D or BiLSTM; increase local epochs to 5</td></tr>
    <tr><td>Very slow convergence</td><td>Too many local epochs with low LR</td><td>Reduce local epochs to 2–3; increase LR slightly</td></tr>
    <tr><td>Training stops before completing rounds</td><td>Early stopping triggered</td><td>Increase patience or disable early stopping</td></tr>
  </tbody>
</table>`
      },
      {
        id: 'tips-deploy',
        title: 'Choosing a Model for Deployment',
        html: `
<p class="manual-p">
  Use the Benchmark page to compare candidate models, then apply these criteria:
</p>
<ol class="manual-steps">
  <li><strong>Safety-critical applications</strong> (fault must not be missed): prioritise <strong>Recall</strong> — especially for Inner Race and Outer Race faults which can lead to catastrophic bearing failure.</li>
  <li><strong>Real-time monitoring</strong> (fast inference required): prioritise <strong>Inference Time</strong> and <strong>Params</strong>. CNN1D is the fastest; ResNet1D may be too slow for sub-10 ms requirements.</li>
  <li><strong>Highest accuracy</strong> (offline analysis): prioritise <strong>Avg F1</strong> and <strong>Accuracy</strong>. ResNet1D or TCN typically wins.</li>
  <li><strong>Deployment on edge hardware</strong> (limited memory): choose the smallest model (fewest parameters) that still exceeds your minimum accuracy threshold.</li>
</ol>
<div class="manual-box warn">
  <span class="box-icon">⚠</span>
  <div class="box-body">
    A high overall accuracy can hide poor performance on a specific fault class.
    <strong>Always check per-class metrics</strong> before deploying, especially Recall
    for fault classes — a model that never detects Ball faults is dangerous even if
    its overall accuracy is 90 %.
  </div>
</div>`
      },
    ],
  },
];

// ── Render ────────────────────────────────────────────────────────────────────
function _renderManual() {
  const toc     = document.getElementById('manual-toc');
  const content = document.getElementById('manual-content');
  toc.innerHTML     = '';
  content.innerHTML = '';

  MANUAL.forEach((sec, si) => {
    // TOC top-level entry
    const tocA = document.createElement('a');
    tocA.href = '#msec-' + sec.id;
    tocA.textContent = `${si + 1}. ${sec.title}`;
    tocA.dataset.target = 'msec-' + sec.id;
    toc.appendChild(tocA);

    // TOC sub-entries
    sec.subs.forEach(sub => {
      const subA = document.createElement('a');
      subA.href = '#msub-' + sub.id;
      subA.className = 'toc-sub';
      subA.textContent = sub.title;
      subA.dataset.target = 'msub-' + sub.id;
      toc.appendChild(subA);
    });

    // Section heading
    const secEl = document.createElement('div');
    secEl.className = 'manual-section';
    secEl.id = 'msec-' + sec.id;
    secEl.innerHTML = `<div class="manual-section-title"><span class="sec-num">${si + 1}</span>${sec.title}</div>`;

    // Sub-sections
    sec.subs.forEach(sub => {
      const subEl = document.createElement('div');
      subEl.className = 'manual-sub';
      subEl.id = 'msub-' + sub.id;
      subEl.innerHTML = `<div class="manual-sub-title">${sub.title}</div>${sub.html}`;
      secEl.appendChild(subEl);
    });

    content.appendChild(secEl);
  });

  // Highlight active TOC entry on scroll
  _attachManualScrollSpy();
}

function _attachManualScrollSpy() {
  const contentEl = document.getElementById('manual-content');
  const tocLinks  = document.querySelectorAll('#manual-toc a[data-target]');
  if (!contentEl || !tocLinks.length) return;

  const onScroll = () => {
    const scrollTop = contentEl.scrollTop + 10;
    let active = tocLinks[0];
    tocLinks.forEach(a => {
      const target = document.getElementById(a.dataset.target);
      if (target && target.offsetTop <= scrollTop) active = a;
    });
    tocLinks.forEach(a => a.classList.remove('active'));
    if (active) active.classList.add('active');
  };

  contentEl.removeEventListener('scroll', contentEl._manualScrollHandler);
  contentEl._manualScrollHandler = onScroll;
  contentEl.addEventListener('scroll', onScroll);
  onScroll();
}

// ── Open / close ──────────────────────────────────────────────────────────────
function openManual() {
  _renderManual();
  document.getElementById('manual-overlay').classList.add('open');
  document.getElementById('manual-modal').classList.add('open');
}

function closeManual() {
  document.getElementById('manual-overlay').classList.remove('open');
  document.getElementById('manual-modal').classList.remove('open');
}

// TOC anchor clicks → smooth scroll inside the content pane
document.addEventListener('click', e => {
  const a = e.target.closest('#manual-toc a');
  if (!a) return;
  e.preventDefault();
  const target = document.getElementById(a.dataset.target);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Close on Escape (alongside guide)
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeManual();
});
