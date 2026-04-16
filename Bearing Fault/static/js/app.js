'use strict';

// ──────────────────────────────────────────────────────────────────────────────
//  Constants
// ──────────────────────────────────────────────────────────────────────────────
const CLIENT_COLORS = [
  '#818cf8','#fb923c','#a78bfa','#38bdf8','#fbbf24',
  '#f472b6','#4ade80','#e879f9','#94a3b8','#f43f5e',
  '#67e8f9','#86efac','#fde68a','#c4b5fd','#fca5a5',
  '#6ee7b7','#93c5fd','#ddd6fe','#fbcfe8','#fed7aa',
];

const CLASS_COLORS = ['#60a5fa','#f87171','#fbbf24','#34d399'];
const CLASS_NAMES  = ['Normal','IR','OR','Ball'];

const CM_BG_LOW  = '#1e293b';
const CM_BG_HIGH = '#6366f1';

// ──────────────────────────────────────────────────────────────────────────────
//  State
// ──────────────────────────────────────────────────────────────────────────────
const STATE = {
  ws: null,
  isTraining: false,
  currentRound: 0,
  numRounds: 0,
  bestAcc: 0,
  charts: {},
  reconnectTimer: null,
  latestModelId: null,   // set when training completes → used to auto-select in Predict tab
  lastConfusionMatrix: null,   // { cm: [[...]], classNames: [...] }
  lastPredictionData:  null,   // full API response from /api/predict
  lastBenchmarkData:   null,   // full API response from /api/benchmark
  lastTrainingConfig:  null,   // snapshot of config at training start
};

// ──────────────────────────────────────────────────────────────────────────────
//  Chart.js global defaults
// ──────────────────────────────────────────────────────────────────────────────
function initChartDefaults() {
  Chart.defaults.color = '#64748b';
  Chart.defaults.borderColor = '#1e293b';
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Chart initialisation
// ──────────────────────────────────────────────────────────────────────────────
function initCharts() {
  initChartDefaults();

  const gridOpts = {
    color: 'rgba(51,65,85,0.6)',
    drawBorder: false,
  };
  const lineBase = {
    tension: 0.35,
    borderWidth: 2,
    pointRadius: 3,
    pointHoverRadius: 5,
    fill: false,
  };

  // Loss chart
  STATE.charts.loss = new Chart(document.getElementById('chart-loss'), {
    type: 'line',
    data: { labels: [], datasets: [{ ...lineBase, label: 'Global Loss', data: [], borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,.1)', fill: true }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      scales: {
        x: { grid: gridOpts, ticks: { color: '#64748b' }, title: { display: true, text: 'Round', color: '#64748b' } },
        y: { grid: gridOpts, ticks: { color: '#64748b' }, title: { display: true, text: 'Loss', color: '#64748b' } },
      },
      plugins: { legend: { display: false } },
    },
  });

  // Accuracy chart
  STATE.charts.acc = new Chart(document.getElementById('chart-acc'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { ...lineBase, label: 'Accuracy',     data: [], borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,.1)', fill: true },
        { ...lineBase, label: 'Best Accuracy', data: [], borderColor: '#818cf8', borderDash: [5,3], pointRadius: 0, fill: false },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      scales: {
        x: { grid: gridOpts, ticks: { color: '#64748b' }, title: { display: true, text: 'Round', color: '#64748b' } },
        y: { grid: gridOpts, ticks: { color: '#64748b', callback: v => (v*100).toFixed(0)+'%' }, min: 0, max: 1,
             title: { display: true, text: 'Accuracy', color: '#64748b' } },
      },
      plugins: { legend: { labels: { color: '#64748b' } } },
    },
  });

  // Per-client chart (populated dynamically)
  STATE.charts.clients = new Chart(document.getElementById('chart-clients'), {
    type: 'line',
    data: { labels: [], datasets: [] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      scales: {
        x: { grid: gridOpts, ticks: { color: '#64748b' }, title: { display: true, text: 'Round', color: '#64748b' } },
        y: { grid: gridOpts, ticks: { color: '#64748b', callback: v => (v*100).toFixed(0)+'%' }, min: 0, max: 1,
             title: { display: true, text: 'Val Accuracy', color: '#64748b' } },
      },
      plugins: { legend: { labels: { color: '#64748b' } } },
    },
  });

  // Distribution chart (stacked bar)
  STATE.charts.dist = new Chart(document.getElementById('chart-dist'), {
    type: 'bar',
    data: {
      labels: [],
      datasets: CLASS_NAMES.map((name, i) => ({
        label: name,
        data: [],
        backgroundColor: CLASS_COLORS[i],
        borderRadius: i === CLASS_NAMES.length - 1 ? { topLeft: 4, topRight: 4 } : 0,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      scales: {
        x: { stacked: true, grid: gridOpts, ticks: { color: '#64748b' } },
        y: { stacked: true, grid: gridOpts, ticks: { color: '#64748b' }, title: { display: true, text: 'Samples', color: '#64748b' } },
      },
      plugins: { legend: { labels: { color: '#64748b' } } },
    },
  });
}

function resetCharts() {
  const { loss, acc, clients, dist } = STATE.charts;
  [loss, acc, dist].forEach(c => { c.data.labels = []; c.data.datasets.forEach(d => d.data = []); c.update('none'); });
  clients.data.labels = [];
  clients.data.datasets = [];
  clients.update('none');
  document.getElementById('cm-container').innerHTML = `
    <div class="empty-state">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
      </svg>
      <span>Available after training completes</span>
    </div>`;
  STATE.bestAcc = 0;
  STATE.currentRound = 0;
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('prog-cur').textContent = '0';
  document.getElementById('stat-acc').textContent = '—';
  document.getElementById('stat-loss').textContent = '—';
  document.getElementById('stat-best').textContent = '—';
  document.getElementById('client-tbody').innerHTML = `
    <tr><td colspan="8" style="text-align:center;color:#334155;padding:20px">
      No training data yet — press Start Training to begin.
    </td></tr>`;
}

// ──────────────────────────────────────────────────────────────────────────────
//  WebSocket
// ──────────────────────────────────────────────────────────────────────────────
function connectWebSocket() {
  setConnBadge('connecting', 'Connecting…');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  STATE.ws = ws;

  ws.onopen = () => setConnBadge('connected', 'Connected');

  ws.onmessage = e => {
    try { handleMessage(JSON.parse(e.data)); }
    catch (err) { console.error('WS parse error:', err); }
  };

  ws.onclose = () => {
    setConnBadge('disconnected', 'Disconnected');
    if (!STATE.reconnectTimer) {
      STATE.reconnectTimer = setTimeout(() => {
        STATE.reconnectTimer = null;
        connectWebSocket();
      }, 3000);
    }
  };

  ws.onerror = () => setConnBadge('disconnected', 'Error');

  // Keep-alive ping every 20s
  setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 20000);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Message dispatch
// ──────────────────────────────────────────────────────────────────────────────
function handleMessage(data) {
  switch (data.type) {
    case 'CONNECTED':        break;
    case 'DATA_DISTRIBUTION': handleDataDistribution(data); break;
    case 'ROUND_START':      handleRoundStart(data);  break;
    case 'ROUND_COMPLETE':   handleRoundComplete(data); break;
    case 'TRAINING_COMPLETE': handleTrainingComplete(data); break;
    case 'TRAINING_ERROR':   handleTrainingError(data); break;
    case 'LOG':              appendLog(data.level, data.message, data.timestamp); break;
    default: console.log('Unknown message:', data);
  }
}

function handleDataDistribution(data) {
  const chart = STATE.charts.dist;
  chart.data.labels = data.clients.map(c => `C${c.client_id}`);

  CLASS_NAMES.forEach((_, cls) => {
    chart.data.datasets[cls].data = data.clients.map(c => c.class_counts[String(cls)] || 0);
  });
  chart.update();
}

function handleRoundStart(data) {
  STATE.numRounds = data.num_rounds;
  document.getElementById('prog-tot').textContent = data.num_rounds;
}

function handleRoundComplete(data) {
  STATE.currentRound = data.round;
  const { loss: lossChart, acc: accChart, clients: clientChart } = STATE.charts;
  const lbl = String(data.round);

  // Loss
  lossChart.data.labels.push(lbl);
  lossChart.data.datasets[0].data.push(data.global.loss);
  lossChart.update('none');

  // Accuracy
  const acc = data.global.accuracy;
  if (acc > STATE.bestAcc) STATE.bestAcc = acc;
  accChart.data.labels.push(lbl);
  accChart.data.datasets[0].data.push(acc);
  // Extend best-line
  accChart.data.datasets[1].data = accChart.data.labels.map(() => STATE.bestAcc);
  accChart.update('none');

  // Per-client chart — ensure dataset exists for each client
  data.clients.forEach(c => {
    let ds = clientChart.data.datasets.find(d => d.clientId === c.client_id);
    if (!ds) {
      const col = CLIENT_COLORS[c.client_id % CLIENT_COLORS.length];
      ds = {
        clientId: c.client_id,
        label: `Client ${c.client_id}`,
        data: new Array(data.round - 1).fill(null),
        borderColor: col,
        backgroundColor: col,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: false,
        spanGaps: false,
      };
      clientChart.data.datasets.push(ds);
    }
    // Align to current round
    while (ds.data.length < data.round - 1) ds.data.push(null);
    ds.data.push(c.val_acc);
  });
  // Fill null for non-selected clients this round
  clientChart.data.datasets.forEach(ds => {
    while (ds.data.length < data.round) ds.data.push(null);
  });
  if (clientChart.data.labels.length < data.round) clientChart.data.labels.push(lbl);
  clientChart.update('none');

  // Progress bar
  const pct = (data.round / data.num_rounds * 100).toFixed(1);
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('prog-cur').textContent = data.round;
  document.getElementById('stat-acc').textContent  = (acc * 100).toFixed(1) + '%';
  document.getElementById('stat-loss').textContent = data.global.loss.toFixed(4);
  document.getElementById('stat-best').textContent = (STATE.bestAcc * 100).toFixed(1) + '%';

  // Client table
  updateClientTable(data.clients, data.selected_clients);
}

function handleTrainingComplete(data) {
  STATE.isTraining = false;
  setTrainingUI(false);
  renderConfusionMatrix(data.confusion_matrix, data.class_names);
  document.getElementById('stat-best').textContent = (data.best_accuracy * 100).toFixed(1) + '%';
  STATE.latestModelId = data.model_id;
  STATE.lastConfusionMatrix = { cm: data.confusion_matrix, classNames: data.class_names };
  loadModelLibrary();   // always refresh so new model is ready in Predict tab
  _showTrainedBanner(data.model_id, data.best_accuracy);
}

function _showTrainedBanner(modelId, bestAcc) {
  const container = document.getElementById('panel-dashboard');
  const old = document.getElementById('trained-model-banner');
  if (old) old.remove();
  const banner = document.createElement('div');
  banner.id = 'trained-model-banner';
  banner.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;border-radius:10px;margin-bottom:14px;border:1px solid rgba(74,222,128,.3);background:rgba(74,222,128,.07);color:#4ade80;font-size:13px;cursor:pointer;';
  banner.onclick = () => { switchTab('predict'); banner.remove(); };
  banner.innerHTML = `
    <span>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px;margin-right:6px"><polyline points="20 6 9 17 4 12"/></svg>
      Model <strong style="color:#86efac">${escHtml(modelId)}</strong> saved &mdash; best accuracy <strong style="color:#86efac">${(bestAcc*100).toFixed(1)}%</strong>
      &nbsp;&middot;&nbsp; <span style="color:#86efac;text-decoration:underline">Open Predict tab &rarr;</span>
    </span>
    <button onclick="event.stopPropagation();document.getElementById('trained-model-banner').remove()" style="background:none;border:none;color:#4ade80;cursor:pointer;font-size:20px;line-height:1;padding:0 4px;opacity:.6">&times;</button>`;
  container.insertBefore(banner, container.firstChild);
}

function handleTrainingError(data) {
  STATE.isTraining = false;
  setTrainingUI(false);
  appendLog('ERROR', data.message, '');
}

// ──────────────────────────────────────────────────────────────────────────────
//  Client table
// ──────────────────────────────────────────────────────────────────────────────
function updateClientTable(clients, selectedIds) {
  const tbody = document.getElementById('client-tbody');
  tbody.innerHTML = '';
  clients.forEach(c => {
    const selected = !selectedIds || selectedIds.includes(c.client_id);
    const statusBadge = selected
      ? '<span class="badge badge-green">▶ Active</span>'
      : '<span class="badge badge-gray">— Idle</span>';
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>Client ${c.client_id}</td>
      <td>${c.train_loss.toFixed(4)}</td>
      <td>${(c.train_acc*100).toFixed(1)}%</td>
      <td>${c.val_loss.toFixed(4)}</td>
      <td>${(c.val_acc*100).toFixed(1)}%</td>
      <td>${c.samples.toLocaleString()}</td>
      <td>${c.local_steps}</td>
      <td>${statusBadge}</td>`;
    tbody.appendChild(row);
  });
}

// ──────────────────────────────────────────────────────────────────────────────
//  Confusion matrix renderer
// ──────────────────────────────────────────────────────────────────────────────
function renderConfusionMatrix(cm, classNames, targetEl) {
  const container = targetEl || document.getElementById('cm-container');
  const n = cm.length;
  const maxVal = Math.max(...cm.flat());

  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return [r,g,b];
  }
  function lerp(a,b,t) { return Math.round(a+(b-a)*t); }
  function cellColor(val) {
    const t = maxVal > 0 ? val/maxVal : 0;
    const [r1,g1,b1] = hexToRgb(CM_BG_LOW);
    const [r2,g2,b2] = hexToRgb(CM_BG_HIGH);
    return `rgb(${lerp(r1,r2,t)},${lerp(g1,g2,t)},${lerp(b1,b2,t)})`;
  }
  function textColor(val) {
    return (maxVal > 0 && val/maxVal > 0.5) ? '#fff' : '#94a3b8';
  }

  let html = '<div style="font-size:10px;color:#64748b;margin-bottom:4px;letter-spacing:.05em">TRUE \\ PREDICTED</div>';
  html += '<div class="cm-grid">';

  // Header row
  html += '<div class="cm-header-cell"></div>';
  classNames.forEach(name => { html += `<div class="cm-header-cell">${name}</div>`; });

  // Data rows
  cm.forEach((row, i) => {
    html += `<div class="cm-row-label">${classNames[i]}</div>`;
    row.forEach((val, j) => {
      const bg = cellColor(val);
      const fg = textColor(val);
      const isCorrect = i === j ? 'border:2px solid rgba(255,255,255,.2);' : '';
      html += `<div class="cm-cell" style="background:${bg};color:${fg};${isCorrect}" title="${classNames[i]}→${classNames[j]}: ${val}">${val}</div>`;
    });
  });

  html += '</div>';

  // Per-class accuracy
  const perClass = cm.map((row, i) => {
    const total = row.reduce((a,b) => a+b, 0);
    return total > 0 ? (row[i]/total*100).toFixed(1)+'%' : '—';
  });
  html += `<div style="display:flex;gap:8px;margin-top:10px">`;
  classNames.forEach((name, i) => {
    html += `<div style="text-align:center;flex:1">
      <div style="font-size:10px;color:#64748b">${name}</div>
      <div style="font-size:14px;font-weight:700;color:${CLASS_COLORS[i]}">${perClass[i]}</div>
    </div>`;
  });
  html += '</div>';

  container.innerHTML = html;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Log console
// ──────────────────────────────────────────────────────────────────────────────
function appendLog(level, message, ts) {
  const console_ = document.getElementById('log-console');
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `
    <span class="log-ts">[${ts || '--:--:--'}]</span>
    <span class="log-level ${level}">${level.padEnd(7)}</span>
    <span class="log-msg">${escHtml(message)}</span>`;
  console_.appendChild(line);
  console_.scrollTop = console_.scrollHeight;

  // Keep log bounded
  while (console_.children.length > 500) console_.removeChild(console_.firstChild);
}

function clearLog() { document.getElementById('log-console').innerHTML = ''; }

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ──────────────────────────────────────────────────────────────────────────────
//  Config collection
// ──────────────────────────────────────────────────────────────────────────────
function collectConfig() {
  const modelType = document.querySelector('input[name="model_type"]:checked').value;
  return {
    num_clients:               parseInt(document.getElementById('num_clients').value),
    partition_strategy:        document.getElementById('partition_strategy').value,
    dirichlet_alpha:           parseFloat(document.getElementById('dirichlet_alpha').value),
    num_rounds:                parseInt(document.getElementById('num_rounds').value),
    fraction_fit:              parseFloat(document.getElementById('fraction_fit').value),
    aggregation_strategy:      document.getElementById('aggregation_strategy').value,
    fedprox_mu:                parseFloat(document.getElementById('fedprox_mu').value),
    early_stopping_patience:   parseInt(document.getElementById('early_stopping_patience').value),
    local_epochs:              parseInt(document.getElementById('local_epochs').value),
    batch_size:                parseInt(document.getElementById('batch_size').value),
    learning_rate:             parseFloat(document.getElementById('learning_rate').value),
    optimizer:                 document.getElementById('optimizer').value,
    lr_scheduler:              document.getElementById('lr_scheduler').value,
    weight_decay:              parseFloat(document.getElementById('weight_decay').value),
    grad_clip:                 parseFloat(document.getElementById('grad_clip').value),
    label_smoothing:           parseFloat(document.getElementById('label_smoothing').value),
    use_augmentation:          document.getElementById('use_augmentation').checked,
    aug_noise_std:             parseFloat(document.getElementById('aug_noise_std').value),
    model_type:                modelType,
    dropout:                   parseFloat(document.getElementById('dropout').value),
    seed:                      parseInt(document.getElementById('seed').value),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
//  Training control
// ──────────────────────────────────────────────────────────────────────────────
async function startTraining() {
  if (STATE.isTraining) return;
  STATE.lastTrainingConfig = collectConfig();
  resetCharts();
  STATE.isTraining = true;
  setTrainingUI(true);

  const config = collectConfig();
  document.getElementById('prog-tot').textContent = config.num_rounds;
  appendLog('INFO', `Starting FL training: ${config.num_rounds} rounds, ${config.num_clients} clients, strategy=${config.aggregation_strategy}`, new Date().toTimeString().slice(0,8));

  try {
    const resp = await fetch('/api/train', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const json = await resp.json();
    if (json.status === 'already_running') {
      appendLog('WARNING', 'A training run is already in progress.', '');
      STATE.isTraining = false;
      setTrainingUI(false);
    }
  } catch (err) {
    appendLog('ERROR', 'Failed to start training: ' + err.message, '');
    STATE.isTraining = false;
    setTrainingUI(false);
  }
}

async function stopTraining() {
  await fetch('/api/stop', { method: 'POST' });
  STATE.isTraining = false;
  setTrainingUI(false);
  appendLog('WARNING', 'Stop requested.', new Date().toTimeString().slice(0,8));
}

// ──────────────────────────────────────────────────────────────────────────────
//  UI helpers
// ──────────────────────────────────────────────────────────────────────────────
function setTrainingUI(running) {
  ['btn-start','btn-start-2'].forEach(id => { document.getElementById(id).disabled = running; });
  ['btn-stop','btn-stop-2'].forEach(id => { document.getElementById(id).disabled = !running; });
}

function setConnBadge(state, text) {
  const badge = document.getElementById('conn-badge');
  badge.className = 'conn-badge ' + state;
  document.getElementById('conn-text').textContent = text;
}

function toggleSidebar() {
  document.getElementById('app').classList.toggle('sidebar-collapsed');
}

function toggleSection(header) {
  header.classList.toggle('collapsed');
  const id = header.id ? header.id.replace('hdr-','sec-') : header.nextElementSibling.id;
  const body = header.nextElementSibling;
  if (body && body.classList.contains('section-body')) {
    body.style.display = header.classList.contains('collapsed') ? 'none' : '';
  }
}

function toggleAlpha() {
  const strat = document.getElementById('partition_strategy').value;
  document.getElementById('field-alpha').classList.toggle('field-hidden', strat !== 'dirichlet');
}

function toggleMu() {
  const strat = document.getElementById('aggregation_strategy').value;
  document.getElementById('field-mu').classList.toggle('field-hidden', strat !== 'fedprox');
}

function toggleAugmentation() {
  const on = document.getElementById('use_augmentation').checked;
  document.getElementById('field-aug-noise').classList.toggle('field-hidden', !on);
}

function resetUI() {
  resetCharts();
  appendLog('INFO', 'Charts reset.', new Date().toTimeString().slice(0,8));
}

// ──────────────────────────────────────────────────────────────────────────────
//  Tab switching
// ──────────────────────────────────────────────────────────────────────────────
function switchTab(name) {
  ['dashboard','predict','benchmark'].forEach(t => {
    document.getElementById(`panel-${t}`).style.display = name === t ? '' : 'none';
    document.getElementById(`tab-${t}`).classList.toggle('active', name === t);
  });
  if (name === 'predict')   loadModelLibrary();
  if (name === 'benchmark') loadBenchmarkLibrary();
}

// ──────────────────────────────────────────────────────────────────────────────
//  Model Library
// ──────────────────────────────────────────────────────────────────────────────
let _selectedModelIds = new Set();
let _libraryOpen = true;

function toggleLibrary() {
  _libraryOpen = !_libraryOpen;
  document.getElementById('model-library-body').style.display = _libraryOpen ? '' : 'none';
  document.getElementById('lib-chevron').style.transform = _libraryOpen ? '' : 'rotate(-90deg)';
}

async function loadModelLibrary() {
  try {
    const r = await fetch('/api/models');
    const d = await r.json();
    renderModelLibrary(d.models || []);
  } catch { /* silent */ }
}

function renderModelLibrary(models) {
  const empty   = document.getElementById('lib-empty');
  const list    = document.getElementById('model-list');
  const badge   = document.getElementById('lib-count-badge');
  const footer  = document.getElementById('lib-selection-footer');

  badge.textContent = `${models.length} model${models.length !== 1 ? 's' : ''}`;

  if (models.length === 0) {
    empty.style.display = '';
    list.style.display  = 'none';
    footer.style.display = 'none';
    _updateClassifyBtn();
    return;
  }

  empty.style.display = 'none';
  list.style.display  = 'flex';
  footer.style.display = 'flex';

  // Prune stale selections
  const validIds = new Set(models.map(m => m.id));
  for (const id of [..._selectedModelIds]) {
    if (!validIds.has(id)) _selectedModelIds.delete(id);
  }

  // Auto-select the most recently trained model (once, then clear the flag)
  const justTrainedId = STATE.latestModelId;
  if (justTrainedId && validIds.has(justTrainedId)) {
    _selectedModelIds.add(justTrainedId);
    STATE.latestModelId = null;
  }

  list.innerHTML = '';
  models.slice().reverse().forEach(m => {  // newest first
    const row = document.createElement('div');
    row.className = 'model-row' + (_selectedModelIds.has(m.id) ? ' selected' : '');
    row.dataset.id = m.id;
    row.onclick = () => toggleModelSelection(m.id);

    const mtype  = m.model_type || 'cnn1d';
    const strat  = m.aggregation_strategy || 'fedavg';
    const part   = m.partition_strategy || 'iid';
    const acc    = m.best_accuracy != null ? (m.best_accuracy * 100).toFixed(1) : '—';
    const accNum = m.best_accuracy != null ? (m.best_accuracy * 100) : 0;
    const dateStr = m.created_at ? new Date(m.created_at).toLocaleString() : '—';

    const typeClass = {cnn1d:'tag-cnn', resnet1d:'tag-res', lstm1d:'tag-lstm', tcn:'tag-tcn'}[mtype] || 'tag-cnn';
    const typeLabel = {cnn1d:'CNN1D', resnet1d:'ResNet1D', lstm1d:'BiLSTM', tcn:'TCN'}[mtype] || mtype.toUpperCase();
    const typeTag  = `<span class="model-tag ${typeClass}">${typeLabel}</span>`;
    const stratTag = `<span class="model-tag tag-${strat}">${strat.toUpperCase()}</span>`;
    const partTag  = `<span class="model-tag ${part==='iid'?'tag-iid':part==='dirichlet'?'tag-dir':'tag-load'}">${part==='dirichlet'?`Dir(${m.dirichlet_alpha??'?'})`:part.toUpperCase()}</span>`;
    const newBadge = m.id === justTrainedId ? `<span class="model-row-new-badge">NEW</span>` : '';

    row.innerHTML = `
      <div class="model-row-checkbox"></div>
      <div class="model-row-main">
        <div class="model-row-name">
          ${typeTag} ${stratTag} ${partTag} ${newBadge}
          <span style="font-size:11px;color:#475569;font-weight:400">${m.num_clients}c · ${m.num_rounds}r · ${m.local_epochs}ep</span>
        </div>
        <div class="model-row-meta">
          <span>Opt: ${m.optimizer||'—'}</span>
          <span>LR: ${m.learning_rate||'—'}</span>
          <span>Best round: ${m.best_round??'—'}</span>
          <span style="color:#475569">${dateStr}</span>
        </div>
        <div class="model-acc-bar" style="margin-top:4px">
          <div class="model-acc-track"><div class="model-acc-fill" style="width:${accNum}%"></div></div>
          <span class="model-acc-text">${acc}%</span>
          <span style="font-size:10px;color:#475569;margin-left:2px">best acc</span>
        </div>
      </div>
      <div class="model-row-actions" onclick="event.stopPropagation()">
        <button class="btn-icon" title="Delete model" onclick="deleteModel('${m.id}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>`;
    list.appendChild(row);
  });

  _updateSelectionFooter(models.length);
  _updateClassifyBtn();
}

function toggleModelSelection(id) {
  if (_selectedModelIds.has(id)) {
    _selectedModelIds.delete(id);
  } else {
    _selectedModelIds.add(id);
  }
  // Update row style
  const row = document.querySelector(`.model-row[data-id="${id}"]`);
  if (row) row.classList.toggle('selected', _selectedModelIds.has(id));
  _updateSelectionFooter();
  _updateClassifyBtn();
}

function selectAllModels() {
  document.querySelectorAll('.model-row').forEach(row => {
    _selectedModelIds.add(row.dataset.id);
    row.classList.add('selected');
  });
  _updateSelectionFooter();
  _updateClassifyBtn();
}

function deselectAllModels() {
  _selectedModelIds.clear();
  document.querySelectorAll('.model-row').forEach(row => row.classList.remove('selected'));
  _updateSelectionFooter();
  _updateClassifyBtn();
}

function _updateSelectionFooter(total) {
  const n   = _selectedModelIds.size;
  const el  = document.getElementById('lib-footer-text');
  const info = document.getElementById('lib-selection-info');
  const msg  = n === 0 ? 'No models selected'
             : n === 1 ? '1 model selected'
             : `${n} models selected — ensemble voting enabled`;
  if (el)   el.textContent = msg;
  if (info) info.textContent = n > 0 ? `${n} selected` : '';
}

function _updateClassifyBtn() {
  const signalReady = parseSignal(document.getElementById('signal-textarea')?.value || '').length >= WINDOW_SIZE
                   || (STATE.pendingFile != null);
  document.getElementById('btn-classify').disabled = _selectedModelIds.size === 0 || !signalReady;
}

async function deleteModel(id) {
  if (!confirm(`Delete model ${id}? This cannot be undone.`)) return;
  try {
    const r = await fetch(`/api/models/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).detail);
    _selectedModelIds.delete(id);
    await loadModelLibrary();
  } catch (e) {
    alert('Delete failed: ' + e.message);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Waveform chart
// ──────────────────────────────────────────────────────────────────────────────
let waveformChart = null;

function initWaveformChart() {
  if (waveformChart) { waveformChart.destroy(); waveformChart = null; }
  waveformChart = new Chart(document.getElementById('chart-waveform'), {
    type: 'line',
    data: { labels: [], datasets: [{ data: [], borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,.07)', borderWidth: 1.5, pointRadius: 0, fill: true, tension: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(51,65,85,.5)' }, ticks: { color: '#475569', maxTicksLimit: 8 }, title: { display: true, text: 'Sample index', color: '#475569' } },
        y: { grid: { color: 'rgba(51,65,85,.5)' }, ticks: { color: '#475569' }, title: { display: true, text: 'Amplitude (g)', color: '#475569' } },
      },
    },
  });
}

function renderWaveform(signal, label) {
  document.getElementById('waveform-card').style.display = '';
  if (!waveformChart) initWaveformChart();
  const step = Math.max(1, Math.floor(signal.length / 512));
  const ds   = signal.filter((_, i) => i % step === 0);
  waveformChart.data.labels = ds.map((_, i) => i * step);
  waveformChart.data.datasets[0].data = ds;
  waveformChart.update('none');
  document.getElementById('waveform-label').textContent = label || '';
}

// ──────────────────────────────────────────────────────────────────────────────
//  Signal input handling
// ──────────────────────────────────────────────────────────────────────────────
const WINDOW_SIZE = 1024;
const WINDOW_STEP = 512;

function parseSignal(text) {
  return text.replace(/,/g, ' ').split(/\s+/).filter(Boolean).map(Number).filter(v => !isNaN(v));
}

function countWindows(n) {
  return n < WINDOW_SIZE ? 0 : Math.floor((n - WINDOW_SIZE) / WINDOW_STEP) + 1;
}

function onTextareaInput() {
  const vals = parseSignal(document.getElementById('signal-textarea').value);
  _updateValueCounter(vals.length);
  if (vals.length >= WINDOW_SIZE) renderWaveform(vals, `${vals.length.toLocaleString()} values`);
  else document.getElementById('waveform-card').style.display = 'none';
  _updateClassifyBtn();
}

function _updateValueCounter(n) {
  const el = document.getElementById('value-count-text');
  const wc = document.getElementById('window-count-text');
  if (n === 0)            { el.textContent = '0 values detected'; el.className = ''; wc.textContent = ''; }
  else if (n < WINDOW_SIZE) { el.textContent = `${n.toLocaleString()} values (need ≥ ${WINDOW_SIZE})`; el.className = 'error'; wc.textContent = ''; }
  else {
    const w = countWindows(n);
    el.textContent = `${n.toLocaleString()} values — ready`; el.className = 'ok';
    wc.textContent = w === 1 ? '1 window' : `${w} windows (512-sample overlap)`;
  }
}

function updateValueCounter(n) { _updateValueCounter(n); }  // alias for legacy calls

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.name.endsWith('.npy')) {
    STATE.pendingFile = file;
    _updateValueCounter(1024);
    document.getElementById('signal-textarea').value = `[NPY file selected: ${file.name}]\nWill be sent directly to server for classification.`;
    document.getElementById('signal-textarea').style.color = '#818cf8';
    document.getElementById('waveform-card').style.display = 'none';
    _updateClassifyBtn();
    return;
  }
  STATE.pendingFile = null;
  document.getElementById('signal-textarea').style.color = '';
  const reader = new FileReader();
  reader.onload = e => { document.getElementById('signal-textarea').value = e.target.result.trim(); onTextareaInput(); };
  reader.readAsText(file);
  event.target.value = '';
}

async function loadSample(classId) {
  const url = classId >= 0 ? `/api/predict/sample?class_id=${classId}` : '/api/predict/sample';
  try {
    const d = await fetch(url).then(r => r.json());
    STATE.pendingFile = null;
    document.getElementById('signal-textarea').style.color = '';
    document.getElementById('signal-textarea').value = d.signal.map(v => v.toFixed(6)).join(', ');
    STATE.sampleTrueLabel = { id: d.true_class_id, name: d.true_class_name };
    onTextareaInput();
    renderWaveform(d.signal, `Sample — True: ${d.true_class_name}`);
  } catch (e) { alert('Could not load sample: ' + e.message); }
}

function clearPredict() {
  document.getElementById('signal-textarea').value = '';
  document.getElementById('signal-textarea').style.color = '';
  document.getElementById('waveform-card').style.display = 'none';
  document.getElementById('result-empty').style.display = '';
  document.getElementById('result-display').style.display = 'none';
  document.getElementById('result-display').innerHTML = '';
  _updateValueCounter(0);
  STATE.pendingFile = null;
  STATE.sampleTrueLabel = null;
  const fi = document.getElementById('file-upload');
  if (fi) fi.value = '';
  _updateClassifyBtn();
}

// ──────────────────────────────────────────────────────────────────────────────
//  Classification
// ──────────────────────────────────────────────────────────────────────────────
async function classifySignal() {
  const ids = [..._selectedModelIds];
  if (ids.length === 0) { alert('Select at least one model from the Model Library.'); return; }

  const btn = document.getElementById('btn-classify');
  btn.disabled = true;
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke-dasharray="30 60"/></svg> Classifying…`;

  try {
    let data;
    if (STATE.pendingFile?.name.endsWith('.npy')) {
      const form = new FormData();
      form.append('file', STATE.pendingFile);
      form.append('model_ids', JSON.stringify(ids));
      const r = await fetch('/api/predict/upload', { method: 'POST', body: form });
      if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
      data = await r.json();
    } else {
      const vals = parseSignal(document.getElementById('signal-textarea').value);
      if (vals.length < WINDOW_SIZE) throw new Error(`Need ≥ ${WINDOW_SIZE} values, got ${vals.length}.`);
      const r = await fetch('/api/predict', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signal: vals, model_ids: ids }),
      });
      if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
      data = await r.json();
    }
    renderPredictionResults(data);
  } catch (e) {
    alert('Classification error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Classify Signal`;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Result rendering
// ──────────────────────────────────────────────────────────────────────────────
function _probBars(probs) {
  return CLASS_NAMES.map((name, i) => {
    const pct = ((probs[name] || 0) * 100).toFixed(1);
    return `<div class="prob-row">
      <span class="prob-label">${name}</span>
      <div class="prob-track"><div class="prob-fill" style="width:${pct}%;background:${CLASS_COLORS[i]}"></div></div>
      <span class="prob-pct" style="color:${CLASS_COLORS[i]}">${pct}%</span>
    </div>`;
  }).join('');
}

function _windowBreakdown(results) {
  if (results.length <= 1) return '';
  const rows = results.map(r => `
    <div class="window-row">
      <span class="window-row-label">Window ${r.window + 1}</span>
      <span class="window-row-pred pred-text-${r.class_id}">${r.class_name}</span>
      <span style="color:#64748b;font-size:11px">${(r.confidence*100).toFixed(1)}%</span>
    </div>`).join('');
  return `<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin:12px 0 6px">Window breakdown</div>${rows}`;
}

function renderPredictionResults(data) {
  STATE.lastPredictionData = data;
  const displayEl = document.getElementById('result-display');
  const emptyEl   = document.getElementById('result-empty');
  emptyEl.style.display   = 'none';
  displayEl.style.display = '';

  const predictions = data.predictions || [];
  const ensemble    = data.ensemble;
  const nWindows    = data.num_windows || 1;
  let html = '';

  // ── Header: true label + analysis summary ──────────────────────────────────
  html += `<div class="results-header">`;
  if (STATE.sampleTrueLabel) {
    html += `<div class="pred-true">&#10003; True label: ${escHtml(STATE.sampleTrueLabel.name)}</div>`;
  } else {
    html += `<div></div>`;
  }
  html += `<div style="font-size:11px;color:#475569">${nWindows} window${nWindows!==1?'s':''} analysed &nbsp;&middot;&nbsp; ${predictions.length} model${predictions.length!==1?'s':''}</div>`;
  html += `</div>`;

  // ── Ensemble badge (multi-model only) ──────────────────────────────────────
  if (ensemble) {
    const cls = ensemble.class_id;
    const voteStr = CLASS_NAMES.map(n => `${n}: ${ensemble.votes[n]}`).join(' &middot; ');
    html += `<div class="ensemble-badge">
      <div class="ensemble-icon">&#9889;</div>
      <div class="ensemble-info">
        <div class="ensemble-title">Ensemble Vote &mdash; ${ensemble.total_models} models</div>
        <div class="ensemble-class pred-text-${cls}">${ensemble.class_name}</div>
        <div class="ensemble-votes">${voteStr}</div>
      </div>
    </div>
    <div class="prob-bars" style="margin-bottom:16px">${_probBars(ensemble.probabilities)}</div>
    <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:10px">Per-model breakdown</div>`;
  }

  // ── Per-model cards — grid layout for 2+ models ───────────────────────────
  if (predictions.length >= 2) html += `<div class="model-results-grid">`;

  predictions.forEach(pm => {
    const dom     = pm.dominant;
    const cls     = dom.class_id;
    const confPct = (dom.confidence * 100).toFixed(1);
    const accPct  = pm.best_accuracy != null ? (pm.best_accuracy * 100).toFixed(1) + '%' : '&mdash;';
    html += `<div class="model-result-card">
      <div class="model-result-header">
        <div class="model-result-label">${escHtml(pm.label)}</div>
        <div style="font-size:11px;color:#475569">trained acc: ${accPct}</div>
      </div>
      <div class="model-result-prediction pred-class-${cls}">
        <div class="pred-icon pred-icon-${cls}" style="width:28px;height:28px;border-radius:50%;flex-shrink:0"></div>
        <div>
          <div class="model-pred-class pred-text-${cls}">${dom.class_name}</div>
          <div class="model-pred-conf">${confPct}% confidence</div>
        </div>
      </div>
      <div class="prob-bars">${_probBars(pm.avg_probabilities)}</div>
      ${_windowBreakdown(pm.results)}
    </div>`;
  });

  if (predictions.length >= 2) html += `</div>`;

  displayEl.innerHTML = html;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Benchmark
// ──────────────────────────────────────────────────────────────────────────────
const _bmSelected = new Set();
const _bmCharts   = {};   // canvasId → Chart instance

async function loadBenchmarkLibrary() {
  try {
    const r = await fetch('/api/models');
    const d = await r.json();
    _renderBmModelList(d.models || []);
  } catch { /* silent */ }
}

function _renderBmModelList(models) {
  const empty  = document.getElementById('bm-empty');
  const list   = document.getElementById('bm-model-list');
  const badge  = document.getElementById('bm-count-badge');
  const footer = document.getElementById('bm-footer');

  badge.textContent = `${models.length} model${models.length !== 1 ? 's' : ''}`;

  if (models.length === 0) {
    empty.style.display  = '';
    list.style.display   = 'none';
    footer.style.display = 'none';
    _updateBmRunBtn();
    return;
  }

  empty.style.display  = 'none';
  list.style.display   = 'flex';
  footer.style.display = 'flex';

  // Prune stale selections
  const validIds = new Set(models.map(m => m.id));
  for (const id of [..._bmSelected]) {
    if (!validIds.has(id)) _bmSelected.delete(id);
  }

  list.innerHTML = '';
  models.slice().reverse().forEach(m => {
    const mtype    = m.model_type || 'cnn1d';
    const strat    = m.aggregation_strategy || 'fedavg';
    const part     = m.partition_strategy || 'iid';
    const acc      = m.best_accuracy != null ? (m.best_accuracy * 100).toFixed(1) : '—';
    const accNum   = m.best_accuracy != null ? (m.best_accuracy * 100) : 0;
    const dateStr  = m.created_at ? new Date(m.created_at).toLocaleString() : '—';

    const typeClass = {cnn1d:'tag-cnn',resnet1d:'tag-res',lstm1d:'tag-lstm',tcn:'tag-tcn'}[mtype] || 'tag-cnn';
    const typeLabel = {cnn1d:'CNN1D',resnet1d:'ResNet1D',lstm1d:'BiLSTM',tcn:'TCN'}[mtype] || mtype.toUpperCase();
    const typeTag   = `<span class="model-tag ${typeClass}">${typeLabel}</span>`;
    const stratTag  = `<span class="model-tag tag-${strat}">${strat.toUpperCase()}</span>`;
    const partTag   = `<span class="model-tag ${part==='iid'?'tag-iid':part==='dirichlet'?'tag-dir':'tag-load'}">${part==='dirichlet'?`Dir(${m.dirichlet_alpha??'?'})`:part.toUpperCase()}</span>`;

    const row = document.createElement('div');
    row.className  = 'model-row' + (_bmSelected.has(m.id) ? ' selected' : '');
    row.dataset.id = m.id;
    row.onclick    = () => _toggleBmModel(m.id);
    row.innerHTML  = `
      <div class="model-row-checkbox"></div>
      <div class="model-row-main">
        <div class="model-row-name">
          ${typeTag} ${stratTag} ${partTag}
          <span style="font-size:11px;color:#475569;font-weight:400">${m.num_clients}c · ${m.num_rounds}r · ${m.local_epochs}ep</span>
        </div>
        <div class="model-row-meta">
          <span>Opt: ${m.optimizer||'—'}</span>
          <span>LR: ${m.learning_rate||'—'}</span>
          <span>Best round: ${m.best_round??'—'}</span>
          <span style="color:#475569">${dateStr}</span>
        </div>
        <div class="model-acc-bar" style="margin-top:4px">
          <div class="model-acc-track"><div class="model-acc-fill" style="width:${accNum}%"></div></div>
          <span class="model-acc-text">${acc}%</span>
          <span style="font-size:10px;color:#475569;margin-left:2px">best acc</span>
        </div>
      </div>`;
    list.appendChild(row);
  });

  _updateBmFooter();
  _updateBmRunBtn();
}

function _toggleBmModel(id) {
  if (_bmSelected.has(id)) _bmSelected.delete(id);
  else                      _bmSelected.add(id);
  const row = document.querySelector(`#bm-model-list .model-row[data-id="${id}"]`);
  if (row) row.classList.toggle('selected', _bmSelected.has(id));
  _updateBmFooter();
  _updateBmRunBtn();
}

function selectAllBmModels() {
  document.querySelectorAll('#bm-model-list .model-row').forEach(r => {
    _bmSelected.add(r.dataset.id);
    r.classList.add('selected');
  });
  _updateBmFooter();
  _updateBmRunBtn();
}

function deselectAllBmModels() {
  _bmSelected.clear();
  document.querySelectorAll('#bm-model-list .model-row').forEach(r => r.classList.remove('selected'));
  _updateBmFooter();
  _updateBmRunBtn();
}

function _updateBmFooter() {
  const n  = _bmSelected.size;
  const el = document.getElementById('bm-footer-text');
  if (el) el.textContent = n === 0 ? 'No models selected'
                         : n === 1 ? '1 model selected — select ≥ 2 for comparison charts'
                         : `${n} models selected`;
}

function _updateBmRunBtn() {
  const btn = document.getElementById('btn-run-benchmark');
  if (btn) btn.disabled = _bmSelected.size === 0;
}

async function runBenchmark() {
  const ids = [..._bmSelected];
  if (ids.length === 0) return;

  const btn = document.getElementById('btn-run-benchmark');
  btn.disabled = true;
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2"
    style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke-dasharray="30 60"/></svg>
    Running&hellip;`;

  document.getElementById('bm-results').style.display = 'none';

  try {
    const r = await fetch('/api/benchmark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_ids: ids }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    const data = await r.json();
    _renderBenchmarkResults(data);
  } catch (e) {
    alert('Benchmark failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
      Run Benchmark`;
    _updateBmRunBtn();
  }
}

function _destroyBmChart(id) {
  if (_bmCharts[id]) { _bmCharts[id].destroy(); delete _bmCharts[id]; }
}

function _fmtParams(n) {
  return n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e3 ? Math.round(n/1e3)+'K' : String(n);
}

function _avg(arr) { return arr.reduce((a,b)=>a+b,0) / arr.length; }

function _renderBenchmarkResults(data) {
  STATE.lastBenchmarkData = data;
  const models     = data.models;
  const classNames = data.class_names;
  const colors     = CLIENT_COLORS;
  const mColors    = models.map((_, i) => colors[i % colors.length]);

  document.getElementById('bm-results').style.display = '';
  document.getElementById('bm-test-info').textContent =
    `· evaluated on ${data.test_samples.toLocaleString()} samples (fixed test set, seed=42)`;

  // ── Summary table ────────────────────────────────────────────────────────────
  let th = `<div class="bm-table-wrap"><table class="bm-table">
    <thead><tr>
      <th>Model</th><th>Accuracy</th><th>Loss</th>
      <th>Avg F1</th><th>Avg Precision</th><th>Avg Recall</th>
      <th>Params</th><th>Time&nbsp;(ms)</th>
    </tr></thead><tbody>`;
  models.forEach((m, i) => {
    const f1  = (_avg(m.per_class_f1)  * 100).toFixed(1);
    const pr  = (_avg(m.per_class_precision) * 100).toFixed(1);
    const re  = (_avg(m.per_class_recall) * 100).toFixed(1);
    th += `<tr>
      <td><span class="bm-color-dot" style="background:${mColors[i]}"></span>${escHtml(m.label)}</td>
      <td class="num-cell">${(m.accuracy*100).toFixed(2)}%</td>
      <td class="num-cell">${m.loss.toFixed(4)}</td>
      <td class="num-cell">${f1}%</td>
      <td class="num-cell">${pr}%</td>
      <td class="num-cell">${re}%</td>
      <td class="num-cell">${_fmtParams(m.num_params)}</td>
      <td class="num-cell">${m.inference_time_ms}</td>
    </tr>`;
  });
  th += `</tbody></table></div>`;
  document.getElementById('bm-summary-table').innerHTML = th;

  const gridOpts = { color: 'rgba(51,65,85,.6)', drawBorder: false };
  const tickClr  = '#64748b';

  // ── Overall Accuracy (horizontal bar) ────────────────────────────────────────
  _destroyBmChart('bm-chart-acc');
  _bmCharts['bm-chart-acc'] = new Chart(document.getElementById('bm-chart-acc'), {
    type: 'bar',
    data: {
      labels: models.map(m => m.short_label),
      datasets: [{
        label: 'Accuracy (%)',
        data: models.map(m => +(m.accuracy*100).toFixed(2)),
        backgroundColor: mColors,
        borderRadius: 5, borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      animation: { duration: 500 },
      scales: {
        x: { min: 0, max: 100, grid: gridOpts, ticks: { color: tickClr, callback: v => v+'%' } },
        y: { grid: { display: false }, ticks: { color: '#94a3b8' } },
      },
      plugins: { legend: { display: false } },
    },
  });

  // ── Inference Time (horizontal bar) ──────────────────────────────────────────
  _destroyBmChart('bm-chart-time');
  _bmCharts['bm-chart-time'] = new Chart(document.getElementById('bm-chart-time'), {
    type: 'bar',
    data: {
      labels: models.map(m => m.short_label),
      datasets: [{
        label: 'Time (ms)',
        data: models.map(m => m.inference_time_ms),
        backgroundColor: mColors,
        borderRadius: 5, borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      animation: { duration: 500 },
      scales: {
        x: { grid: gridOpts, ticks: { color: tickClr, callback: v => v+'ms' } },
        y: { grid: { display: false }, ticks: { color: '#94a3b8' } },
      },
      plugins: { legend: { display: false } },
    },
  });

  // ── Multi-Metric Radar ───────────────────────────────────────────────────────
  _destroyBmChart('bm-chart-radar');
  _bmCharts['bm-chart-radar'] = new Chart(document.getElementById('bm-chart-radar'), {
    type: 'radar',
    data: {
      labels: ['Accuracy', 'Avg F1', 'Avg Precision', 'Avg Recall'],
      datasets: models.map((m, i) => ({
        label: m.short_label,
        data: [
          +(m.accuracy*100).toFixed(1),
          +(_avg(m.per_class_f1)*100).toFixed(1),
          +(_avg(m.per_class_precision)*100).toFixed(1),
          +(_avg(m.per_class_recall)*100).toFixed(1),
        ],
        borderColor: mColors[i],
        backgroundColor: mColors[i] + '28',
        borderWidth: 2,
        pointBackgroundColor: mColors[i],
        pointRadius: 4,
        pointHoverRadius: 6,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
      scales: {
        r: {
          min: 0, max: 100,
          grid: { color: 'rgba(51,65,85,.5)' },
          angleLines: { color: 'rgba(51,65,85,.5)' },
          ticks: { color: tickClr, backdropColor: 'transparent', callback: v => v+'%', stepSize: 20 },
          pointLabels: { color: '#94a3b8', font: { size: 11 } },
        },
      },
      plugins: { legend: { labels: { color: tickClr } } },
    },
  });

  // ── Per-Class Accuracy (grouped bar) ─────────────────────────────────────────
  _destroyBmChart('bm-chart-class-acc');
  _bmCharts['bm-chart-class-acc'] = new Chart(document.getElementById('bm-chart-class-acc'), {
    type: 'bar',
    data: {
      labels: classNames,
      datasets: models.map((m, i) => ({
        label: m.short_label,
        data: m.per_class_accuracy.map(v => +(v*100).toFixed(1)),
        backgroundColor: mColors[i],
        borderRadius: 4,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
      scales: {
        x: { grid: gridOpts, ticks: { color: '#94a3b8' } },
        y: { min: 0, max: 100, grid: gridOpts, ticks: { color: tickClr, callback: v => v+'%' } },
      },
      plugins: { legend: { labels: { color: tickClr } } },
    },
  });

  // ── Per-Class F1 (grouped bar) ────────────────────────────────────────────────
  _destroyBmChart('bm-chart-f1');
  _bmCharts['bm-chart-f1'] = new Chart(document.getElementById('bm-chart-f1'), {
    type: 'bar',
    data: {
      labels: classNames,
      datasets: models.map((m, i) => ({
        label: m.short_label,
        data: m.per_class_f1.map(v => +(v*100).toFixed(1)),
        backgroundColor: mColors[i],
        borderRadius: 4,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
      scales: {
        x: { grid: gridOpts, ticks: { color: '#94a3b8' } },
        y: { min: 0, max: 100, grid: gridOpts, ticks: { color: tickClr, callback: v => v+'%' } },
      },
      plugins: { legend: { labels: { color: tickClr } } },
    },
  });

  // ── Confusion Matrices (one per model) ───────────────────────────────────────
  const cmsEl = document.getElementById('bm-cms');
  cmsEl.innerHTML = '';
  const cmGrid = document.createElement('div');
  cmGrid.className = 'bm-cm-grid';

  models.forEach((m, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'bm-cm-wrap';

    const lbl = document.createElement('div');
    lbl.className = 'bm-cm-label';
    lbl.innerHTML = `<span class="bm-color-dot" style="background:${mColors[i]}"></span>${escHtml(m.short_label)}
      <span style="margin-left:auto;font-size:11px;color:#475569">${(m.accuracy*100).toFixed(1)}% acc</span>`;

    const cmEl = document.createElement('div');
    renderConfusionMatrix(m.confusion_matrix, classNames, cmEl);

    wrap.appendChild(lbl);
    wrap.appendChild(cmEl);
    cmGrid.appendChild(wrap);
  });

  cmsEl.appendChild(cmGrid);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Boot
// ──────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  connectWebSocket();
  toggleAlpha();
  toggleMu();
  toggleAugmentation();
  STATE.pendingFile = null;
  STATE.sampleTrueLabel = null;
  appendLog('INFO', 'Dashboard loaded. Configure settings and press Start Training.', new Date().toTimeString().slice(0,8));
});

// ──────────────────────────────────────────────────────────────────────────────
//  Chat Widget
// ──────────────────────────────────────────────────────────────────────────────
const CHAT = {
  open: false,
  history: [],     // [{role:"user"|"assistant", content:"..."}]
  busy: false,
};

function toggleChat() {
  CHAT.open = !CHAT.open;

  document.getElementById('chat-panel').classList.toggle('chat-open', CHAT.open);
  document.getElementById('chat-fab').classList.toggle('chat-open', CHAT.open);

  // swap icons
  document.getElementById('chat-icon-open').style.display  = CHAT.open ? 'none' : '';
  document.getElementById('chat-icon-close').style.display = CHAT.open ? ''     : 'none';

  if (CHAT.open) {
    // inject welcome message on first open
    if (CHAT.history.length === 0) {
      _chatAppend('bot',
        "Hi! I'm the **BearingFL Assistant**.\n" +
        "Ask me anything about bearing faults, federated learning strategies, " +
        "model types, training settings, or how to use this dashboard."
      );
    }
    setTimeout(() => document.getElementById('chat-input').focus(), 280);
    _chatScrollBottom();
  }
}

function _chatAppend(role, text) {
  const container = document.getElementById('chat-messages');
  const row = document.createElement('div');
  row.className = `chat-msg ${role}`;

  const avatarLabel = role === 'bot' ? 'AI' : 'Me';
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.innerHTML = _chatFormat(text);

  const avatar = document.createElement('div');
  avatar.className = 'chat-msg-avatar';
  avatar.textContent = avatarLabel;

  row.appendChild(avatar);
  row.appendChild(bubble);
  container.appendChild(row);
  _chatScrollBottom();
  return row;
}

function _chatFormat(text) {
  // Escape HTML then apply minimal markdown
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

function _chatShowTyping() {
  const container = document.getElementById('chat-messages');
  const row = document.createElement('div');
  row.className = 'chat-msg bot';
  row.id = 'chat-typing-row';
  row.innerHTML = `
    <div class="chat-msg-avatar">AI</div>
    <div class="chat-bubble">
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
    </div>`;
  container.appendChild(row);
  _chatScrollBottom();
}

function _chatHideTyping() {
  const el = document.getElementById('chat-typing-row');
  if (el) el.remove();
}

function _chatScrollBottom() {
  const el = document.getElementById('chat-messages');
  if (el) el.scrollTop = el.scrollHeight;
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text || CHAT.busy) return;

  CHAT.busy = true;
  input.value = '';
  input.disabled = true;
  document.getElementById('chat-send').disabled = true;

  _chatAppend('user', text);
  CHAT.history.push({ role: 'user', content: text });

  _chatShowTyping();

  try {
    const res  = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        message: text,
        history: CHAT.history.slice(-10),
      }),
    });
    _chatHideTyping();

    if (!res.ok) {
      _chatAppend('bot', `⚠️ Server error (${res.status}). Please try again.`);
    } else {
      const data  = await res.json();
      const reply = data.reply || 'Sorry, no response received.';
      _chatAppend('bot', reply);
      CHAT.history.push({ role: 'assistant', content: reply });
    }
  } catch (_) {
    _chatHideTyping();
    _chatAppend('bot', '⚠️ Could not reach the server. Check your connection.');
  } finally {
    CHAT.busy = false;
    input.disabled = false;
    document.getElementById('chat-send').disabled = false;
    input.focus();
  }
}
