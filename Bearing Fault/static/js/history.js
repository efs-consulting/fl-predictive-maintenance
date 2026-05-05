'use strict';
/* ── BearingFL — Training History viewer ──────────────────────────────────── */

const HIST_CLASS_NAMES  = ['Normal', 'Inner Race', 'Outer Race', 'Ball'];
const HIST_CLASS_COLORS = ['#4ade80', '#f87171', '#fbbf24', '#818cf8'];

let _charts = {};   // active Chart.js instances keyed by canvas id
let _data   = null; // currently loaded metrics payload
let _roundHistory = [];

// ── Bootstrap ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await populateModelSelect();
});

async function populateModelSelect() {
  const sel = document.getElementById('model-select');
  try {
    const res = await fetch('/api/models?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load model list');
    const { models } = await res.json();

    if (!models || models.length === 0) {
      sel.innerHTML = '<option value="">— No saved models found —</option>';
      return;
    }

    // Sort newest first
    models.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    sel.innerHTML = '<option value="">— Select a model —</option>';
    for (const m of models) {
      const label_map = { cnn1d: 'CNN1D', resnet1d: 'ResNet1D', lstm1d: 'BiLSTM', tcn: 'TCN' };
      const mtype = label_map[m.model_type] || m.model_type.toUpperCase();
      const strat = (m.aggregation_strategy || '').toUpperCase();
      const date  = m.created_at ? new Date(m.created_at).toLocaleString() : '';
      const acc   = m.best_accuracy != null ? `${(m.best_accuracy * 100).toFixed(2)}%` : '';
      const opt   = document.createElement('option');
      opt.value       = m.id;
      opt.textContent = `${mtype} · ${strat} · ${m.num_clients}c · ${m.num_rounds}r — ${acc} — ${date}`;
      sel.appendChild(opt);
    }
  } catch (e) {
    sel.innerHTML = '<option value="">— Error loading models —</option>';
    console.error(e);
  }
}

async function loadModel(modelId) {
  const empty = document.getElementById('history-empty');
  const data  = document.getElementById('history-data');

  if (!modelId) {
    empty.style.display = '';
    data.style.display  = 'none';
    return;
  }

  empty.innerHTML = '<div style="padding:60px 0;text-align:center;color:#475569">Loading metrics…</div>';
  empty.style.display = '';
  data.style.display  = 'none';

  try {
    const res = await fetch(`/api/models/${encodeURIComponent(modelId)}/metrics`);
    if (res.status === 404) {
      empty.innerHTML = `
        <div style="padding:60px 0;text-align:center;color:#ef4444">
          No metrics file found for this model.<br>
          <span style="color:#475569;font-size:.8rem">This model was saved before the History feature was added.
          Re-train to capture full metrics.</span>
        </div>`;
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    _data = await res.json();
    _roundHistory = _data.training.round_history || [];

    renderAll(_data);

    empty.style.display = 'none';
    data.style.display  = '';
  } catch (e) {
    empty.innerHTML = `<div style="padding:60px 0;text-align:center;color:#ef4444">Error: ${e.message}</div>`;
    console.error(e);
  }
}

// ── Main renderer ────────────────────────────────────────────────────────────

function renderAll(d) {
  destroyAllCharts();

  renderSummaryCards(d);
  renderTrainingCurves(d.training.round_history);
  renderClientSection(d.training.round_history);
  renderConfusionMatrix(d.evaluation);
  renderPerClassChart(d.evaluation);
  renderPerClassTable(d.evaluation);
  renderDistribution(d.data_distribution);
  renderConfig(d.config);
}

// ── Summary cards ────────────────────────────────────────────────────────────

function renderSummaryCards(d) {
  const t  = d.training;
  const ev = d.evaluation;
  const f1s = ev.per_class_f1 || [];
  const macroF1 = f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : null;

  setText('hc-best-acc',   pct(t.best_accuracy));
  setText('hc-best-round', `Best at round ${t.best_round}`);
  setText('hc-final-acc',  pct(t.final_accuracy));
  setText('hc-final-loss', `Final loss ${t.final_loss?.toFixed(4) ?? '—'}`);
  setText('hc-rounds',     `${t.round_history.length}`);
  setText('hc-elapsed',    `${formatTime(t.total_elapsed_seconds)}`);
  setText('hc-macro-f1',   macroF1 != null ? pct(macroF1) : '—');
  setText('hc-clients',    `${d.config.num_clients} clients`);
}

// ── Training curves ──────────────────────────────────────────────────────────

function renderTrainingCurves(rounds) {
  const labels    = rounds.map(r => `R${r.round}`);
  const lossData  = rounds.map(r => r.global_loss);
  const accData   = rounds.map(r => +(r.global_accuracy * 100).toFixed(2));

  // Mark best round
  const bestRound = _data.training.best_round;
  const bestIdx   = rounds.findIndex(r => r.round === bestRound);

  makeChart('hist-chart-loss', 'line', labels, [{
    label: 'Global Loss',
    data: lossData,
    borderColor: '#f87171',
    backgroundColor: 'rgba(248,113,113,.08)',
    tension: .35, fill: true, pointRadius: 3,
  }], { yLabel: 'Loss', bestIdx });

  makeChart('hist-chart-acc', 'line', labels, [{
    label: 'Global Accuracy (%)',
    data: accData,
    borderColor: '#4ade80',
    backgroundColor: 'rgba(74,222,128,.08)',
    tension: .35, fill: true, pointRadius: 3,
  }], { yLabel: 'Accuracy (%)', bestIdx, yMax: 100 });
}

// ── Per-client section ───────────────────────────────────────────────────────

function renderClientSection(rounds) {
  if (!rounds.length) return;
  const slider = document.getElementById('client-round-slider');
  slider.max   = rounds.length;
  slider.value = rounds.length;
  updateClientView(rounds.length);
}

function updateClientView(val) {
  const idx   = Math.max(0, Math.min(parseInt(val) - 1, _roundHistory.length - 1));
  const round = _roundHistory[idx];
  document.getElementById('client-round-label').textContent = `Round ${round.round}`;
  document.getElementById('client-round-slider').value = round.round;

  renderClientCharts(round);
  renderClientTable(round);
}

function renderClientCharts(round) {
  const clients = round.clients || [];
  const ids     = clients.map(c => `C${c.client_id}`);

  destroyChart('hist-chart-clients-acc');
  makeChart('hist-chart-clients-acc', 'bar', ids, [
    { label: 'Train Acc (%)', data: clients.map(c => +(c.train_acc*100).toFixed(2)), backgroundColor: 'rgba(99,102,241,.7)' },
    { label: 'Val Acc (%)',   data: clients.map(c => +(c.val_acc*100).toFixed(2)),   backgroundColor: 'rgba(74,222,128,.7)' },
  ], { yLabel: 'Accuracy (%)', yMax: 100 });

  destroyChart('hist-chart-clients-loss');
  makeChart('hist-chart-clients-loss', 'bar', ids, [
    { label: 'Train Loss', data: clients.map(c => +c.train_loss.toFixed(4)), backgroundColor: 'rgba(248,113,113,.7)' },
    { label: 'Val Loss',   data: clients.map(c => +c.val_loss.toFixed(4)),   backgroundColor: 'rgba(251,191,36,.7)' },
  ], { yLabel: 'Loss' });
}

function renderClientTable(round) {
  const tbody = document.getElementById('client-detail-body');
  tbody.innerHTML = '';
  for (const c of (round.clients || [])) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>Client ${c.client_id}</td>
      <td>${c.train_loss.toFixed(4)}</td>
      <td>${pct(c.train_acc)}</td>
      <td>${c.val_loss.toFixed(4)}</td>
      <td>${pct(c.val_acc)}</td>
      <td>${c.samples.toLocaleString()}</td>
      <td>${c.local_steps}</td>`;
    tbody.appendChild(tr);
  }
}

// ── Confusion matrix ─────────────────────────────────────────────────────────

function renderConfusionMatrix(ev) {
  const cm     = ev.confusion_matrix || [];
  const names  = ev.class_names || HIST_CLASS_NAMES;
  const wrap   = document.getElementById('cm-wrap');

  if (!cm.length) { wrap.innerHTML = '<span style="color:#475569">No data</span>'; return; }

  const rowSums = cm.map(row => row.reduce((a, b) => a + b, 0));
  const maxVal  = Math.max(...cm.flat());

  let html = '<table class="cm-table"><thead><tr><th>True \\ Pred</th>';
  for (const n of names) html += `<th>${n}</th>`;
  html += '</tr></thead><tbody>';

  for (let i = 0; i < cm.length; i++) {
    html += `<tr><th style="text-align:left">${names[i]}</th>`;
    for (let j = 0; j < cm[i].length; j++) {
      const v    = cm[i][j];
      const norm = maxVal > 0 ? v / maxVal : 0;
      const bg   = i === j
        ? `rgba(74,222,128,${(0.15 + norm * 0.65).toFixed(2)})`
        : norm > 0.05 ? `rgba(248,113,113,${(norm * 0.5).toFixed(2)})` : 'transparent';
      const cls  = i === j ? ' cm-diag' : '';
      html += `<td class="${cls}" style="background:${bg}">${v}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ── Per-class bar chart ──────────────────────────────────────────────────────

function renderPerClassChart(ev) {
  const names = ev.class_names || HIST_CLASS_NAMES;
  makeChart('hist-chart-perclass', 'bar', names, [
    { label: 'Accuracy',  data: (ev.per_class_accuracy  || []).map(v => +(v*100).toFixed(2)), backgroundColor: 'rgba(74,222,128,.75)' },
    { label: 'Precision', data: (ev.per_class_precision || []).map(v => +(v*100).toFixed(2)), backgroundColor: 'rgba(99,102,241,.75)' },
    { label: 'Recall',    data: (ev.per_class_recall    || []).map(v => +(v*100).toFixed(2)), backgroundColor: 'rgba(251,191,36,.75)' },
    { label: 'F1',        data: (ev.per_class_f1        || []).map(v => +(v*100).toFixed(2)), backgroundColor: 'rgba(248,113,113,.75)' },
  ], { yLabel: '%', yMax: 100 });
}

// ── Per-class table ──────────────────────────────────────────────────────────

function renderPerClassTable(ev) {
  const names  = ev.class_names || HIST_CLASS_NAMES;
  const acc    = ev.per_class_accuracy  || [];
  const prec   = ev.per_class_precision || [];
  const rec    = ev.per_class_recall    || [];
  const f1     = ev.per_class_f1        || [];
  const tbody  = document.getElementById('perclass-body');
  tbody.innerHTML = '';

  for (let i = 0; i < names.length; i++) {
    const color = HIST_CLASS_COLORS[i] || '#94a3b8';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600;color:${color}">${names[i]}</td>
      <td>${metricCell(acc[i])}</td>
      <td>${metricCell(prec[i])}</td>
      <td>${metricCell(rec[i])}</td>
      <td>${metricCell(f1[i])}</td>`;
    tbody.appendChild(tr);
  }

  // Macro averages row
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const tr  = document.createElement('tr');
  tr.style.borderTop = '2px solid #1e293b';
  tr.innerHTML = `
    <td style="font-weight:700;color:#94a3b8">Macro Avg</td>
    <td>${metricCell(avg(acc))}</td>
    <td>${metricCell(avg(prec))}</td>
    <td>${metricCell(avg(rec))}</td>
    <td style="font-weight:700">${metricCell(avg(f1))}</td>`;
  tbody.appendChild(tr);
}

function metricCell(v) {
  if (v == null) return '—';
  const pv = +(v * 100).toFixed(2);
  return `<div class="pct-bar-wrap">
    <div class="pct-bar" style="width:${Math.max(pv, 2)}px;max-width:80px"></div>
    <span class="pct-val">${pv}%</span>
  </div>`;
}

// ── Data distribution ────────────────────────────────────────────────────────

function renderDistribution(dist) {
  if (!dist || !dist.clients || !dist.clients.length) return;
  const clients = dist.clients;
  const labels  = clients.map(c => `C${c.client_id}`);

  const classKeys = Object.keys(clients[0].class_counts || {}).sort((a, b) => +a - +b);
  const datasets  = classKeys.map((k, i) => ({
    label:           HIST_CLASS_NAMES[+k] || `Class ${k}`,
    data:            clients.map(c => c.class_counts[k] || 0),
    backgroundColor: HIST_CLASS_COLORS[i] || '#94a3b8',
  }));

  makeChart('hist-chart-dist', 'bar', labels, datasets,
    { yLabel: 'Samples', stacked: true });
}

// ── Config ───────────────────────────────────────────────────────────────────

function renderConfig(cfg) {
  const grid = document.getElementById('config-grid');
  grid.innerHTML = '';
  const keys = [
    ['model_type',            'Model Type'],
    ['aggregation_strategy',  'Aggregation'],
    ['partition_strategy',    'Partition'],
    ['num_clients',           'Clients'],
    ['num_rounds',            'Rounds'],
    ['local_epochs',          'Local Epochs'],
    ['batch_size',            'Batch Size'],
    ['learning_rate',         'Learning Rate'],
    ['optimizer',             'Optimizer'],
    ['lr_scheduler',          'LR Scheduler'],
    ['weight_decay',          'Weight Decay'],
    ['grad_clip',             'Grad Clip'],
    ['fraction_fit',          'Fraction Fit'],
    ['fedprox_mu',            'FedProx μ'],
    ['dirichlet_alpha',       'Dirichlet α'],
    ['dropout',               'Dropout'],
    ['label_smoothing',       'Label Smoothing'],
    ['use_augmentation',      'Augmentation'],
    ['early_stopping_patience','Early Stop Patience'],
    ['seed',                  'Seed'],
  ];
  for (const [k, label] of keys) {
    if (cfg[k] == null) continue;
    const div = document.createElement('div');
    div.className = 'config-item';
    div.innerHTML = `<div class="config-key">${label}</div>
                     <div class="config-val">${cfg[k]}</div>`;
    grid.appendChild(div);
  }
}

// ── Chart helpers ────────────────────────────────────────────────────────────

function makeChart(id, type, labels, datasets, opts = {}) {
  destroyChart(id);
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const plugins = {};
  if (opts.bestIdx != null && opts.bestIdx >= 0) {
    plugins.annotation = {
      annotations: {
        bestLine: {
          type: 'line', xMin: opts.bestIdx, xMax: opts.bestIdx,
          borderColor: 'rgba(251,191,36,.6)', borderWidth: 1.5,
          borderDash: [4, 3],
          label: { content: 'Best', display: true, color: '#fbbf24', font: { size: 10 } },
        },
      },
    };
  }

  _charts[id] = new Chart(ctx, {
    type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      animation: { duration: 400 },
      plugins: {
        legend: { labels: { color: '#94a3b8', boxWidth: 12, font: { size: 11 } } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { stacked: opts.stacked || false, ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: '#0f172a' } },
        y: {
          stacked: opts.stacked || false,
          ticks: { color: '#64748b', font: { size: 10 } },
          grid: { color: '#1e293b' },
          max: opts.yMax,
          title: opts.yLabel ? { display: true, text: opts.yLabel, color: '#475569', font: { size: 10 } } : undefined,
        },
      },
    },
  });
}

function destroyChart(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

function destroyAllCharts() {
  Object.keys(_charts).forEach(destroyChart);
}

// ── Utilities ────────────────────────────────────────────────────────────────

function pct(v) {
  if (v == null) return '—';
  return `${(v * 100).toFixed(2)}%`;
}

function formatTime(secs) {
  if (secs == null) return '—';
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60), s = Math.round(secs % 60);
  return `${m}m ${s}s`;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
