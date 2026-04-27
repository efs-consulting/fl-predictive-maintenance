'use strict';

// ──────────────────────────────────────────────────────────────────────────────
//  BearingFL — Professional PDF Report Generator
//  Covers the full session: all training runs, predictions, and benchmarks
//  Uses jsPDF + jsPDF-autoTable
// ──────────────────────────────────────────────────────────────────────────────

// Called from console or a UI button to wipe accumulated session data
function clearSession() {
  try { localStorage.removeItem('bearingfl_session'); } catch (e) {}
  if (typeof STATE !== 'undefined' && STATE.session) {
    STATE.session.trainingRuns  = [];
    STATE.session.predictions   = [];
    STATE.session.benchmarkRuns = [];
    STATE.session._currentRun   = null;
    STATE.session.startTime     = new Date().toISOString();
  }
  console.info('BearingFL: session cleared');
}

async function _loadEFSLogo() {
  return new Promise(async (resolve) => {
    try {
      const resp = await fetch('/static/efs-logo.svg');
      if (!resp.ok) { resolve(null); return; }
      let svgText = await resp.text();
      // Inject explicit size — SVG with only viewBox renders at 0×0 on canvas in most browsers
      svgText = svgText.replace(
        /(<svg[^>]*?)(\s+width="[^"]*")?(\s+height="[^"]*")?([^>]*>)/,
        '$1 width="272" height="214"$4'
      );
      const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width  = 272;
          canvas.height = 214;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, 272, 214);
          ctx.drawImage(img, 0, 0, 272, 214);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    } catch (e) { resolve(null); }
  });
}

async function _getLLMAnalysis(prompt, sessionCtx) {
  const TIMEOUT_MS = 90000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: prompt, history: [], session_context: sessionCtx || '' }),
      signal:  controller.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return (data.reply || '').trim() || null;
  } catch (e) {
    if (e.name === 'AbortError') return '__timeout__';
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Main entry point
// ──────────────────────────────────────────────────────────────────────────────
async function generateReport() {
  const btn = document.getElementById('btn-report');
  if (btn) { btn.disabled = true; btn.innerHTML = 'Requesting AI analysis… (up to 90 s)'; }

  try {
    // ── Resolve session data ─────────────────────────────────────────────────
    // Re-read from localStorage to pick up any saves that happened on other pages
    // since this page was loaded, then merge with the live STATE.session.
    let freshSession = null;
    try {
      const raw = localStorage.getItem('bearingfl_session');
      if (raw) freshSession = JSON.parse(raw);
    } catch (_) {}

    // Merge: take the LARGER set between localStorage and in-memory STATE.session
    // (in-memory may have newer rounds not yet flushed, localStorage may have data
    //  from other pages that were never loaded into this tab's STATE)
    const liveSession = (typeof STATE !== 'undefined' && STATE.session) ? STATE.session : null;
    const sessionObj  = liveSession || freshSession;

    function _pickLonger(a, b) { return (a?.length ?? 0) >= (b?.length ?? 0) ? (a || []) : (b || []); }

    const trainingRuns  = _pickLonger(liveSession?.trainingRuns,  freshSession?.trainingRuns);
    const predictions   = _pickLonger(liveSession?.predictions,   freshSession?.predictions);
    const benchmarkRuns = _pickLonger(liveSession?.benchmarkRuns, freshSession?.benchmarkRuns);

    // Include any in-progress run that has data (from either source)
    const liveCurrentRun  = liveSession?._currentRun;
    const freshCurrentRun = freshSession?._currentRun;
    const currentRun = (liveCurrentRun?.rounds?.length ?? 0) >= (freshCurrentRun?.rounds?.length ?? 0)
      ? liveCurrentRun : freshCurrentRun;

    // Build the full list: completed runs + any in-progress run (appended last)
    const allTrainingRuns = [...trainingRuns];
    if (currentRun?.rounds?.length > 0) {
      allTrainingRuns.push({ ...currentRun, incomplete: true });
    }

    // Build legacy single-entry arrays from STATE.last* so sections always have data
    const effectiveRuns  = allTrainingRuns.length  ? allTrainingRuns  : (STATE?.lastTrainingConfig ? [{
      timestamp:        null,
      config:           STATE.lastTrainingConfig,
      rounds:           (STATE?.charts?.loss?.data?.datasets?.[0]?.data || []).map((loss, i) => ({
                          round: i + 1,
                          loss,
                          acc: (STATE?.charts?.acc?.data?.datasets?.[0]?.data || [])[i] ?? null,
                        })),
      bestAcc:          STATE?.bestAcc ?? 0,
      finalLoss:        null,
      modelId:          STATE?.latestModelId ?? null,
      confusionMatrix:  STATE?.lastConfusionMatrix ?? null,
      dataDistribution: null,
      clientMetricsFinal: null,
    }] : []);

    const effectivePreds = predictions.length ? predictions : (STATE?.lastPredictionData ? [{
      timestamp: null, inputSource: 'Unknown', trueLabel: null, result: STATE.lastPredictionData,
    }] : []);

    const effectiveBMs = benchmarkRuns.length ? benchmarkRuns : (STATE?.lastBenchmarkData ? [{
      timestamp: null, result: STATE.lastBenchmarkData,
    }] : []);

    console.log(`BearingFL: generateReport — ${effectiveRuns.length} runs (${currentRun?.rounds?.length ?? 0} in-progress), ${effectivePreds.length} preds, ${effectiveBMs.length} benchmarks`);

    const hasTrained    = effectiveRuns.length > 0;
    const hasPrediction = effectivePreds.length > 0;
    const hasBenchmark  = effectiveBMs.length > 0;

    // Best run (highest bestAcc)
    const bestRun = effectiveRuns.reduce((best, r) => (!best || r.bestAcc > best.bestAcc ? r : best), null);
    const classNames = bestRun?.confusionMatrix?.classNames
      || STATE?.lastConfusionMatrix?.classNames
      || (typeof CLASS_NAMES !== 'undefined' ? CLASS_NAMES : ['Normal','IR','OR','Ball']);

    // ── Build LLM analysis prompt ────────────────────────────────────────────
    const promptParts = [
      `Analyze the following Federated Learning (FL) experiment session for bearing fault detection.\nSession started: ${sessionObj?.startTime ?? 'unknown'}\n`,
    ];
    if (effectiveRuns.length > 0) {
      promptParts.push(`## Training Runs (${effectiveRuns.length} total)`);
      effectiveRuns.forEach((run, ri) => {
        const cfg = run.config || {};
        promptParts.push(`\n### Run ${ri + 1}${run.timestamp ? '  (' + new Date(run.timestamp).toLocaleTimeString() + ')' : ''}`);
        promptParts.push(`- Model: ${cfg.model_type || 'N/A'}, Strategy: ${cfg.aggregation_strategy || 'N/A'}`);
        promptParts.push(`- Clients: ${cfg.num_clients || 'N/A'}, Rounds: ${run.rounds.length || cfg.num_rounds || 'N/A'}`);
        promptParts.push(`- Best Accuracy: ${((run.bestAcc || 0) * 100).toFixed(2)}%`);
        if (run.finalLoss != null) promptParts.push(`- Final Loss: ${run.finalLoss.toFixed(4)}`);
        if (run.confusionMatrix?.cm) {
          const cm = run.confusionMatrix.cm;
          const names = run.confusionMatrix.classNames || classNames;
          names.forEach((name, i) => {
            const row = cm[i]; const total = row.reduce((a, b) => a + b, 0);
            const tp = cm[i][i];
            const fp = cm.reduce((s, r, ri) => ri !== i ? s + (r[i] || 0) : s, 0);
            const fn = total - tp;
            const rec  = (tp + fn) > 0 ? ((tp / (tp + fn)) * 100).toFixed(1) + '%' : 'N/A';
            const prec = (tp + fp) > 0 ? ((tp / (tp + fp)) * 100).toFixed(1) + '%' : 'N/A';
            promptParts.push(`  - ${name}: Recall=${rec}, Precision=${prec}`);
          });
        }
      });
    }
    if (effectivePreds.length > 0) {
      promptParts.push(`\n## Prediction Results (${effectivePreds.length} total)`);
      effectivePreds.forEach((p, pi) => {
        const ens = p.result?.ensemble;
        const conf = ens?.probabilities?.[ens?.class_name];
        promptParts.push(`- Prediction ${pi + 1}: ${p.inputSource}${p.trueLabel ? ' (true: ' + p.trueLabel.name + ')' : ''} → ${ens?.class_name || 'N/A'} (${conf != null ? (conf * 100).toFixed(1) + '%' : 'N/A'} confidence)`);
      });
    }
    if (effectiveBMs.length > 0) {
      promptParts.push(`\n## Benchmark Comparison (${effectiveBMs.length} run${effectiveBMs.length > 1 ? 's' : ''})`);
      effectiveBMs[effectiveBMs.length - 1].result?.models?.forEach(m => {
        const acc   = m.accuracy != null ? (m.accuracy * 100).toFixed(2) + '%' : 'N/A';
        const f1arr = m.per_class_f1;
        const avgF1 = f1arr?.length ? (f1arr.reduce((a, b) => a + b, 0) / f1arr.length * 100).toFixed(1) + '%' : 'N/A';
        promptParts.push(`  - ${m.label || m.short_label}: Accuracy=${acc}, Avg F1=${avgF1}`);
      });
    }
    promptParts.push(
      '\nThe full session context (all 20 config parameters, training curve, confusion matrices, per-client metrics, prediction probabilities, benchmark per-class metrics) is available to you via the system context.',
      '\nProvide a structured technical analysis with these sections:',
      '1. Overall Session Assessment — summarise what was achieved, noting best accuracy and number of runs',
      '2. Training Performance & Convergence — analyse loss/accuracy curves, convergence speed, any signs of overfitting or underfitting',
      '3. Per-Class Fault Detection Insights — which fault classes (Normal, Inner Race, Outer Race, Ball) were detected well or poorly, and why',
      '4. Federated Learning Strategy Evaluation — assess the chosen aggregation strategy, number of clients, data partitioning, and FL-specific hyperparameters',
      '5. Recommendations for Improvement — concrete, actionable suggestions for better accuracy, faster convergence, or improved fault detection',
      '6. Conclusion — one-paragraph summary of the session outcomes',
      '\nUse plain text only. Start each section on its own line with the number and title (e.g., "1. Overall Session Assessment"). Be specific, technical, and data-driven — cite the actual numbers from the session data above.'
    );

    // ── Build session context string for LLM (gives it full detail) ──────────
    const sessionCtxStr = typeof _buildSessionContext === 'function' ? _buildSessionContext() : '';

    // ── Parallel: logo + LLM ─────────────────────────────────────────────────
    const [logoDataURL, llmRaw] = await Promise.all([
      _loadEFSLogo(),
      _getLLMAnalysis(promptParts.join('\n'), sessionCtxStr),
    ]);
    const llmTimedOut = llmRaw === '__timeout__';
    const llmAnalysis = llmTimedOut ? null : llmRaw;

    if (btn) btn.innerHTML = 'Building PDF…';

    // ── jsPDF setup ──────────────────────────────────────────────────────────
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const PW = 210, PH = 297, ML = 20, MR = 20, MT = 22, CW = PW - ML - MR;
    const generatedAt = new Date();

    const C = {
      navy:     [15,  23,  42],
      dark:     [40,  40,  40],
      mid:      [90,  90,  90],
      light:    [150, 150, 150],
      rule:     [200, 200, 200],
      rowAlt:   [247, 247, 247],
      offwhite: [252, 252, 252],
      white:    [255, 255, 255],
    };

    let sectionNum = 1;
    function nextSection() { return ++sectionNum; }

    function drawPageBg() {
      doc.setFillColor(...C.white);
      doc.rect(0, 0, PW, PH, 'F');
    }
    function hRule(y, color, weight) {
      doc.setDrawColor(...(color || C.rule));
      doc.setLineWidth(weight || 0.25);
      doc.line(ML, y, PW - MR, y);
    }
    function drawFooter(pageNum, totalPages) {
      const y = PH - 12;
      hRule(y - 1, C.rule, 0.25);
      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.light);
      doc.text('BearingFL — Federated Learning Session Report', ML, y + 4);
      doc.text(generatedAt.toLocaleDateString('en-GB', { year:'numeric', month:'long', day:'numeric' }), PW / 2, y + 4, { align: 'center' });
      doc.text(`Page ${pageNum} of ${totalPages}`, PW - MR, y + 4, { align: 'right' });
    }
    function drawSectionHeader(title, y) {
      doc.setFillColor(...C.navy); doc.rect(ML, y, CW, 9, 'F');
      doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.white);
      doc.text(title, ML + 5, y + 6.2);
      return y + 15;
    }
    function drawSubHeader(title, y) {
      doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.navy);
      doc.text(title, ML, y);
      hRule(y + 2.5, C.navy, 0.5);
      return y + 8;
    }
    function drawRunHeader(label, y) {
      doc.setFillColor(...C.rowAlt); doc.rect(ML, y, CW, 9, 'F');
      doc.setDrawColor(...C.rule); doc.setLineWidth(0.25); doc.rect(ML, y, CW, 9, 'S');
      doc.setFillColor(...C.navy); doc.rect(ML, y, 3, 9, 'F');
      doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.navy);
      doc.text(label, ML + 7, y + 6);
      return y + 13;
    }
    function drawStatCard(x, y, w, h, label, value) {
      doc.setFillColor(...C.offwhite); doc.rect(x, y, w, h, 'F');
      doc.setDrawColor(...C.rule); doc.setLineWidth(0.3); doc.rect(x, y, w, h, 'S');
      doc.setFillColor(...C.navy); doc.rect(x, y, 1.5, h, 'F');
      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.light);
      doc.text(label.toUpperCase(), x + w / 2, y + 5.5, { align: 'center' });
      doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.navy);
      doc.text(value, x + w / 2, y + 14, { align: 'center' });
    }
    function addChartImage(canvasId, x, y, w, h) {
      try {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const img = canvas.toDataURL('image/png', 1.0);
        doc.setFillColor(...C.rowAlt); doc.rect(x, y, w, h, 'F');
        doc.setDrawColor(...C.rule); doc.setLineWidth(0.25); doc.rect(x, y, w, h, 'S');
        doc.addImage(img, 'PNG', x, y, w, h);
      } catch (e) {}
    }
    function checkPageBreak(y, needed) {
      if (y + needed > PH - 20) { doc.addPage(); drawPageBg(); return MT; }
      return y;
    }
    function makeTable(opts) {
      doc.autoTable({
        theme: 'plain',
        styles: { fontSize: 8, cellPadding: { top: 2.5, bottom: 2.5, left: 3.5, right: 3.5 }, textColor: C.dark, lineColor: C.rule, lineWidth: 0.2, fillColor: C.white, font: 'helvetica' },
        headStyles: { fillColor: C.navy, textColor: C.white, fontStyle: 'bold', fontSize: 8 },
        alternateRowStyles: { fillColor: C.rowAlt },
        ...opts,
      });
      return doc.lastAutoTable.finalY + 7;
    }
    function drawConfusionMatrix(cm, names, x, y, cellSize) {
      const n = cm.length, labelW = 16;
      doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.light);
      doc.text('TRUE \\ PRED', x, y - 2);
      names.forEach((name, j) => {
        doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.mid);
        doc.text(name, x + labelW + j * cellSize + cellSize / 2, y + 3, { align: 'center' });
      });
      const maxVal = Math.max(...cm.flat(), 1);
      cm.forEach((row, i) => {
        doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.mid);
        doc.text(names[i], x + labelW - 2, y + 8 + i * cellSize + cellSize / 2, { align: 'right' });
        row.forEach((val, j) => {
          const t = maxVal > 0 ? val / maxVal : 0;
          const cx = x + labelW + j * cellSize, cy = y + 8 + i * cellSize;
          doc.setFillColor(Math.round(255-(255-15)*t), Math.round(255-(255-23)*t), Math.round(255-(255-42)*t));
          doc.rect(cx, cy, cellSize, cellSize, 'F');
          doc.setDrawColor(...C.rule); doc.setLineWidth(0.15); doc.rect(cx, cy, cellSize, cellSize, 'S');
          if (i === j) { doc.setDrawColor(...C.navy); doc.setLineWidth(0.5); doc.rect(cx+0.3, cy+0.3, cellSize-0.6, cellSize-0.6, 'S'); }
          doc.setFontSize(i===j?7.5:6.5); doc.setFont('helvetica', i===j?'bold':'normal');
          doc.setTextColor(...(t > 0.5 ? C.white : C.dark));
          doc.text(String(val), cx + cellSize/2, cy + cellSize/2 + 2, { align: 'center' });
        });
      });
      return y + 8 + n * cellSize + 6;
    }
    function renderAnalysisText(text, startY) {
      let y = startY;
      for (const raw of text.split('\n')) {
        const line = raw.trimEnd();
        if (!line.trim()) { y += 3; continue; }
        const headingMatch = line.trim().match(/^(\d+)\.\s+\**(.+?)\**\s*$/);
        if (headingMatch) {
          y = checkPageBreak(y, 20); y += 4;
          y = drawSubHeader(`${headingMatch[1]}.  ${headingMatch[2].replace(/\*\*/g,'')}`, y); continue;
        }
        const boldHead = line.trim().match(/^\*\*([^*]+)\*\*\s*$/);
        if (boldHead) { y = checkPageBreak(y, 14); y = drawSubHeader(boldHead[1].trim(), y); continue; }
        const mdHead = line.trim().match(/^#{1,3}\s+(.+)/);
        if (mdHead) { y = checkPageBreak(y, 14); y = drawSubHeader(mdHead[1].replace(/\*\*/g,'').trim(), y); continue; }
        const bulletMatch = line.match(/^(\s*)[•\-\*]\s+(.+)/);
        if (bulletMatch) {
          const indent = bulletMatch[1].length > 2 ? 10 : 5;
          const content = bulletMatch[2].replace(/\*\*/g, '').trim();
          const wrapped = doc.splitTextToSize(content, CW - indent - 6);
          y = checkPageBreak(y, 5 * wrapped.length + 4);
          doc.setFillColor(...C.navy); doc.circle(ML + indent - 1.5, y - 0.8, 0.9, 'F');
          doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.dark);
          wrapped.forEach(wl => { doc.text(wl, ML + indent, y); y += 5; });
          y += 1; continue;
        }
        const content = line.replace(/\*\*/g, '').trim();
        if (!content) { y += 2; continue; }
        const wrapped = doc.splitTextToSize(content, CW);
        y = checkPageBreak(y, 5 * wrapped.length + 3);
        doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.dark);
        wrapped.forEach(wl => { doc.text(wl, ML, y); y += 5; }); y += 2;
      }
      return y;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PAGE 1 — COVER
    // ══════════════════════════════════════════════════════════════════════════
    drawPageBg();
    doc.setFillColor(...C.navy); doc.rect(0, 0, PW, 4, 'F');

    // EFS Logo top-left
    if (logoDataURL) {
      const logoW = 26, logoH = Math.round(26 * 107 / 136);
      doc.addImage(logoDataURL, 'PNG', ML, 7, logoW, logoH);
    }

    let y = 18;
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.light);
    doc.text('BEARINGFL FEDERATED LEARNING PLATFORM', PW - MR, y, { align: 'right' });

    y = 42;
    doc.setFontSize(32); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.navy);
    doc.text('Session Report', PW / 2, y, { align: 'center' });

    y += 6; hRule(y, C.navy, 0.8);
    y += 5;
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.mid);
    doc.text('Bearing Fault Detection via Federated Learning', PW / 2, y, { align: 'center' });
    y += 5; hRule(y, C.rule, 0.25);

    y += 8;
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.mid);
    const dateStr = generatedAt.toLocaleDateString('en-GB', { year:'numeric', month:'long', day:'numeric' });
    const timeStr = generatedAt.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    const sessionStart = sessionObj?.startTime ? new Date(sessionObj.startTime).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) : '—';
    doc.text(`Report generated: ${dateStr}  ·  ${timeStr}`, PW / 2, y, { align: 'center' });
    y += 6;
    doc.text(`Session started: ${sessionStart}  ·  Model: ${(bestRun?.config?.model_type || '—').toUpperCase()}  ·  Strategy: ${(bestRun?.config?.aggregation_strategy || '—').toUpperCase()}`, PW / 2, y, { align: 'center' });

    // Session summary stat cards
    y += 14;
    const cardW = (CW - 15) / 4;
    const bestAccVal  = bestRun ? ((bestRun.bestAcc || 0) * 100).toFixed(1) + '%' : '—';
    const totalRounds = effectiveRuns.reduce((sum, r) => sum + (r.rounds?.length || 0), 0);
    drawStatCard(ML,               y, cardW, 22, 'Best Accuracy',    bestAccVal);
    drawStatCard(ML+(cardW+5),     y, cardW, 22, 'Training Runs',    String(effectiveRuns.length || 0));
    drawStatCard(ML+(cardW+5)*2,   y, cardW, 22, 'Predictions',      String(effectivePreds.length || 0));
    drawStatCard(ML+(cardW+5)*3,   y, cardW, 22, 'Total FL Rounds',  String(totalRounds || '—'));

    // Table of contents
    y += 32; hRule(y, C.navy, 0.6);
    y += 5;
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.navy);
    doc.text('Contents', ML, y);
    y += 8;

    const sections = [{ n: 1, title: 'Cover & Session Summary' }];
    { let sn = 2;
      sections.push({ n: sn++, title: llmAnalysis ? 'AI Analysis & Recommendations' : (llmTimedOut ? 'AI Analysis (timed out)' : 'AI Analysis (unavailable)') });
      if (hasTrained) {
        sections.push({ n: sn++, title: `Experiment Configuration${effectiveRuns.length > 1 ? ' (' + effectiveRuns.length + ' runs)' : ''}` });
        sections.push({ n: sn++, title: `Training Results${effectiveRuns.length > 1 ? ' — ' + effectiveRuns.length + ' runs' : ''}` });
        sections.push({ n: sn++, title: 'Data Distribution & Evaluation' });
      }
      if (hasPrediction) sections.push({ n: sn++, title: `Prediction Results (${effectivePreds.length} total)` });
      if (hasBenchmark)  sections.push({ n: sn++, title: `Benchmark Comparison (${effectiveBMs.length} run${effectiveBMs.length > 1 ? 's' : ''})` });
    }
    sections.forEach((s, i) => {
      const rowY = y + i * 9;
      if (i % 2 === 0) { doc.setFillColor(...C.rowAlt); doc.rect(ML, rowY - 2.5, CW, 9, 'F'); }
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.navy);
      doc.text(String(s.n), ML + 4, rowY + 3.5);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.dark);
      doc.text(s.title, ML + 12, rowY + 3.5);
      const numX = PW - MR - 10, txtW = doc.getTextWidth(s.title), startX = ML + 12 + txtW + 3;
      doc.setDrawColor(...C.rule); doc.setLineWidth(0.2);
      for (let dx = startX; dx < numX - 2; dx += 2.5) doc.circle(dx, rowY + 2.8, 0.2, 'F');
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.light);
      doc.text(String(s.n), numX + 4, rowY + 3.5, { align: 'right' });
    });

    const coverBrandY = PH - 20;
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.light);
    doc.text('Powered by Flower Federated Learning  ·  flower.ai', PW - MR, coverBrandY, { align: 'right' });
    doc.setFillColor(...C.navy); doc.rect(0, PH - 4, PW, 4, 'F');

    // ══════════════════════════════════════════════════════════════════════════
    //  PAGE 2 — AI ANALYSIS & RECOMMENDATIONS
    // ══════════════════════════════════════════════════════════════════════════
    doc.addPage(); drawPageBg(); y = MT;
    y = drawSectionHeader(`${nextSection()}.  AI Analysis & Recommendations`, y);

    doc.setFillColor(...C.navy); doc.rect(ML, y, CW, 8, 'F');
    doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(...C.white);
    doc.text('Generated by EFS AI Solution Team — powered by LM Studio / Gemma 4 26B', ML+4, y+5.2);
    y += 13;

    if (llmTimedOut) {
      doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(...C.mid);
      doc.text('AI analysis timed out (> 90 s). Ensure the LLM service is responsive and regenerate the report.', ML, y+6);
    } else if (!llmAnalysis) {
      doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(...C.mid);
      doc.text('AI analysis could not be generated. Ensure the LLM service is running and retry.', ML, y+6);
    } else {
      y = renderAnalysisText(llmAnalysis, y);
    }


    // ══════════════════════════════════════════════════════════════════════════
    //  EXPERIMENT CONFIGURATION  (all training runs)
    // ══════════════════════════════════════════════════════════════════════════
    if (hasTrained) {
    doc.addPage(); drawPageBg(); y = MT;
    y = drawSectionHeader(`${nextSection()}.  Experiment Configuration`, y);

    effectiveRuns.forEach((run, ri) => {
        const cfg = run.config || {};
        if (effectiveRuns.length > 1) {
          y = checkPageBreak(y, 16);
          const ts     = run.timestamp ? '  (' + new Date(run.timestamp).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + ')' : '';
          const status = run.interrupted ? '  [interrupted]' : (run.incomplete ? '  [incomplete]' : '');
          y = drawRunHeader(`Run ${ri + 1} of ${effectiveRuns.length}${ts}${status}`, y);
        }
        if (Object.keys(cfg).length === 0) {
          doc.setFontSize(9); doc.setTextColor(...C.mid);
          doc.text('Configuration not captured for this run.', ML, y + 5); y += 12; return;
        }
        const halfW = (CW - 10) / 2, leftX = ML, rightX = ML + halfW + 10;
        const yR = y;

        doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...C.navy);
        doc.text('Data & FL Settings', leftX, yR);
        y = makeTable({
          startY: yR + 4,
          head: [['Parameter','Value']],
          body: [
            ['Clients',              String(cfg.num_clients        ?? '—')],
            ['FL Rounds',            String(cfg.num_rounds         ?? '—')],
            ['Aggregation Strategy', String(cfg.aggregation_strategy ?? '—')],
            ['Partition Strategy',   String(cfg.partition_strategy ?? '—')],
            ['Dirichlet Alpha',      String(cfg.dirichlet_alpha    ?? '—')],
            ['Fraction Fit',         String(cfg.fraction_fit       ?? '—')],
            ['FedProx μ',            String(cfg.fedprox_mu         ?? '—')],
            ['Early Stop Patience',  String(cfg.early_stopping_patience ?? '—')],
          ],
          margin: { left: leftX, right: rightX + halfW - ML }, tableWidth: halfW,
        });
        const leftY = y;

        doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...C.navy);
        doc.text('Local Training & Model', rightX, yR);
        makeTable({
          startY: yR + 4,
          head: [['Parameter','Value']],
          body: [
            ['Model Type',      String(cfg.model_type    ?? '—')],
            ['Local Epochs',    String(cfg.local_epochs  ?? '—')],
            ['Batch Size',      String(cfg.batch_size    ?? '—')],
            ['Learning Rate',   String(cfg.learning_rate ?? '—')],
            ['Optimizer',       String(cfg.optimizer     ?? '—')],
            ['LR Scheduler',    String(cfg.lr_scheduler  ?? '—')],
            ['Weight Decay',    String(cfg.weight_decay  ?? '—')],
            ['Dropout',         String(cfg.dropout       ?? '—')],
            ['Gradient Clip',   String(cfg.grad_clip     ?? '—')],
            ['Label Smoothing', String(cfg.label_smoothing ?? '—')],
            ['Augmentation',    cfg.use_augmentation ? 'Enabled (σ=' + (cfg.aug_noise_std ?? '?') + ')' : 'Disabled'],
            ['Random Seed',     String(cfg.seed          ?? '—')],
          ],
          margin: { left: rightX, right: MR }, tableWidth: halfW,
        });
        y = Math.max(leftY, doc.lastAutoTable.finalY + 7) + 4;
      });
    } // end hasTrained (config)

    // ══════════════════════════════════════════════════════════════════════════
    //  TRAINING RESULTS  (one sub-section per run)
    // ══════════════════════════════════════════════════════════════════════════
    if (hasTrained) {
    doc.addPage(); drawPageBg(); y = MT;
    y = drawSectionHeader(`${nextSection()}.  Training Results`, y);

    effectiveRuns.forEach((run, ri) => {
        y = checkPageBreak(y, 35);
        if (effectiveRuns.length > 1) {
          const ts     = run.timestamp ? '  (' + new Date(run.timestamp).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + ')' : '';
          const status = run.interrupted ? '  [interrupted]' : '';
          y = drawRunHeader(`Run ${ri + 1} of ${effectiveRuns.length}${ts}${status}  ·  Model: ${run.config?.model_type || '—'}  ·  Strategy: ${run.config?.aggregation_strategy || '—'}`, y);
        }

        // Stat cards per run
        const lossHistory = run.rounds.map(r => r.loss);
        const accHistory  = run.rounds.map(r => r.acc);
        const cW3 = (CW - 10) / 3;
        const fAcc  = accHistory.length  > 0 ? ((accHistory[accHistory.length-1]  || 0) * 100).toFixed(2) + '%' : '—';
        const fLoss = lossHistory.length > 0 ? (lossHistory[lossHistory.length-1] || 0).toFixed(4)             : '—';
        const bAcc  = ((run.bestAcc || 0) * 100).toFixed(2) + '%';

        y = checkPageBreak(y, 28);
        drawStatCard(ML,              y, cW3, 20, 'Final Accuracy', fAcc);
        drawStatCard(ML+(cW3+5),      y, cW3, 20, 'Final Loss',     fLoss);
        drawStatCard(ML+(cW3+5)*2,    y, cW3, 20, 'Best Accuracy',  bAcc);
        y += 26;

        // Charts — only rendered when canvas elements exist (training page)
        if (ri === 0 && document.getElementById('chart-loss')) {
          y = checkPageBreak(y, 66);
          const chartH = 52, halfCW = CW / 2 - 4;
          doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...C.navy);
          doc.text('Figure 1 — Global Loss per Round', ML, y);
          doc.text('Figure 2 — Global Accuracy per Round', ML + halfCW + 8, y);
          y += 4;
          addChartImage('chart-loss', ML,              y, halfCW, chartH);
          addChartImage('chart-acc',  ML + halfCW + 8, y, halfCW, chartH);
          y += chartH + 10;
          y = checkPageBreak(y, 66);
          doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...C.navy);
          doc.text('Figure 3 — Per-Client Validation Accuracy', ML, y);
          y += 4;
          addChartImage('chart-clients', ML, y, CW, chartH);
          y += chartH + 10;
        }

        // Round-by-round table from session history
        if (run.rounds.length > 0) {
          y = checkPageBreak(y, 32);
          y = drawSubHeader(`Run ${ri + 1} — Round-by-Round History (${run.rounds.length} rounds)`, y);
          const histRows = run.rounds.map(r => [
            String(r.round),
            r.loss != null ? r.loss.toFixed(4)              : '—',
            r.acc  != null ? (r.acc * 100).toFixed(2) + '%' : '—',
            r.round === run.rounds.length ? 'Final' : '',
          ]);
          y = makeTable({
            startY: y,
            head: [['Round','Loss','Accuracy','Note']],
            body: histRows,
            margin: { left: ML, right: MR },
            columnStyles: {
              0: { cellWidth: 22, halign: 'center' },
              1: { cellWidth: 34, halign: 'right'  },
              2: { cellWidth: 38, halign: 'right'  },
              3: { cellWidth: CW - 94, halign: 'center' },
            },
          });
        }

        // Client metrics from session (final round)
        if (run.clientMetricsFinal?.length) {
          y = checkPageBreak(y, 32);
          y = drawSubHeader(`Run ${ri + 1} — Client Metrics (Final Round)`, y);
          const cmRows = run.clientMetricsFinal.map(c => [
            `Client ${c.client_id}`,
            c.train_loss  != null ? c.train_loss.toFixed(4)             : '—',
            c.train_acc   != null ? (c.train_acc * 100).toFixed(2) + '%' : '—',
            c.val_loss    != null ? c.val_loss.toFixed(4)               : '—',
            c.val_acc     != null ? (c.val_acc * 100).toFixed(2) + '%'  : '—',
            c.num_samples != null ? String(c.num_samples)               : '—',
          ]);
          y = makeTable({
            startY: y,
            head: [['Client','Train Loss','Train Acc','Val Loss','Val Acc','Samples']],
            body: cmRows, margin: { left: ML, right: MR },
          });
        }
        y += 4;
      });
    } // end hasTrained (training results)

    // ══════════════════════════════════════════════════════════════════════════
    //  DATA DISTRIBUTION & EVALUATION  (confusion matrix per run)
    // ══════════════════════════════════════════════════════════════════════════
    if (hasTrained) {
    doc.addPage(); drawPageBg(); y = MT;
    y = drawSectionHeader(`${nextSection()}.  Data Distribution & Evaluation`, y);

    effectiveRuns.forEach((run, ri) => {
        if (effectiveRuns.length > 1) {
          y = checkPageBreak(y, 14);
          const ts = run.timestamp ? '  (' + new Date(run.timestamp).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + ')' : '';
          y = drawRunHeader(`Run ${ri + 1}${ts}`, y);
        }

        // Data distribution chart (only on training page, first run)
        if (ri === 0 && document.getElementById('chart-dist')) {
          doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...C.navy);
          doc.text(`Figure 4 — Data Distribution per Client`, ML, y);
          y += 4; addChartImage('chart-dist', ML, y, CW, 52); y += 58;
        } else if (run.dataDistribution?.clients) {
          // Render distribution as table when chart not available
          y = checkPageBreak(y, 32);
          y = drawSubHeader('Data Distribution per Client', y);
          const distRows = run.dataDistribution.clients.map(c => {
            const counts = classNames.map((_, ci) => String(c.class_counts?.[String(ci)] || 0));
            return [`Client ${c.client_id}`, ...counts];
          });
          y = makeTable({
            startY: y,
            head: [['Client', ...classNames]],
            body: distRows,
            margin: { left: ML, right: MR },
          });
        }

        const cmInfo = run.confusionMatrix || STATE?.lastConfusionMatrix;
        if (cmInfo?.cm) {
          const cm = cmInfo.cm, names = cmInfo.classNames || classNames;
          y = checkPageBreak(y, 70);
          y = drawSubHeader(`Run ${ri + 1} — Confusion Matrix`, y);
          const cellSz = Math.min(20, (CW * 0.55) / cm.length);
          y = drawConfusionMatrix(cm, names, ML, y, cellSz);
          y += 4;

          // Per-class accuracy row
          y = checkPageBreak(y, 22);
          const perW = CW / names.length;
          names.forEach((name, i) => {
            const total = cm[i].reduce((a, b) => a + b, 0);
            const pct   = total > 0 ? ((cm[i][i] / total) * 100).toFixed(1) + '%' : '—';
            const pcX   = ML + i * perW;
            doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(...C.light);
            doc.text(name, pcX + perW/2, y + 4, { align: 'center' });
            doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(...C.navy);
            doc.text(pct, pcX + perW/2, y + 11, { align: 'center' });
          });
          y += 18;
        }
        y += 4;
      });
    } // end hasTrained (data distribution)

    // ══════════════════════════════════════════════════════════════════════════
    //  PREDICTION RESULTS  (all predictions this session)
    // ══════════════════════════════════════════════════════════════════════════
    if (hasPrediction) {
    doc.addPage(); drawPageBg(); y = MT;
    y = drawSectionHeader(`${nextSection()}.  Prediction Results`, y);

    effectivePreds.forEach((pred, pi) => {
        y = checkPageBreak(y, 30);
        const ts = pred.timestamp ? new Date(pred.timestamp).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : null;
        const header = `Prediction ${pi + 1} of ${effectivePreds.length}${ts ? '  (' + ts + ')' : ''}  ·  Input: ${pred.inputSource || 'Unknown'}${pred.trueLabel ? '  ·  True: ' + pred.trueLabel.name : ''}`;
        y = drawRunHeader(header, y);

        const data = pred.result || {};
        const predictions = data.predictions || [];
        const ensemble    = data.ensemble    || null;
        const nWin        = data.num_windows || 1;

        doc.setFontSize(8.5); doc.setFont('helvetica','normal'); doc.setTextColor(...C.mid);
        doc.text(`${nWin} window${nWin!==1?'s':''} analysed  ·  ${predictions.length} model${predictions.length!==1?'s':''} evaluated`, ML, y);
        y += 10;

        if (ensemble) {
          y = checkPageBreak(y, 26);
          doc.setFillColor(...C.navy); doc.rect(ML, y, CW, 20, 'F');
          doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(...C.rowAlt);
          doc.text('ENSEMBLE DECISION', ML + 5, y + 5);
          doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(...C.white);
          doc.text(ensemble.class_name || '—', ML + 5, y + 15);
          const voteStr = classNames.map(n => `${n}: ${ensemble.votes?.[n] ?? 0}`).join('   ');
          doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(...C.rowAlt);
          doc.text(`Votes — ${voteStr}`, PW - MR, y + 15, { align: 'right' });
          y += 26;

          // Probability bars
          const barW = CW * 0.56;
          classNames.forEach(name => {
            const prob = ensemble.probabilities?.[name] || 0;
            const fillLen = barW * prob;
            doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(...C.dark);
            doc.text(name, ML, y + 4);
            doc.setFillColor(...C.rowAlt); doc.setDrawColor(...C.rule); doc.setLineWidth(0.2);
            doc.rect(ML + 22, y, barW, 5, 'FD');
            if (fillLen > 0) { doc.setFillColor(...C.navy); doc.rect(ML + 22, y, Math.max(fillLen,1), 5, 'F'); }
            doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...C.navy);
            doc.text((prob*100).toFixed(1)+'%', ML + 22 + barW + 4, y + 4);
            y += 8;
          });
          y += 4;
        }

        if (predictions.length > 0) {
          y = checkPageBreak(y, 24);
          y = drawSubHeader('Per-Model Predictions', y);
          const pmRows = predictions.map(pm => {
            const dom = pm.dominant || {};
            return [
              pm.label || '—',
              dom.class_name || '—',
              dom.confidence  != null ? (dom.confidence  * 100).toFixed(1) + '%' : '—',
              pm.best_accuracy != null ? (pm.best_accuracy * 100).toFixed(1) + '%' : '—',
            ];
          });
          y = makeTable({
            startY: y,
            head: [['Model','Prediction','Confidence','Training Acc']],
            body: pmRows,
            margin: { left: ML, right: MR },
            columnStyles: {
              0: { cellWidth: CW * 0.46 },
              1: { cellWidth: CW * 0.20, halign: 'center' },
              2: { cellWidth: CW * 0.17, halign: 'right'  },
              3: { cellWidth: CW * 0.17, halign: 'right'  },
            },
          });
        }
        y += 6;
      });
    } // end hasPrediction

    // ══════════════════════════════════════════════════════════════════════════
    //  BENCHMARK COMPARISON  (all benchmark runs)
    // ══════════════════════════════════════════════════════════════════════════
    if (hasBenchmark) {
    doc.addPage(); drawPageBg(); y = MT;
    y = drawSectionHeader(`${nextSection()}.  Benchmark Comparison`, y);

    effectiveBMs.forEach((bm, bi) => {
        const data = bm.result || {};
        const bmModels  = data.models      || [];
        const bmClasses = data.class_names || classNames;

        if (effectiveBMs.length > 1) {
          y = checkPageBreak(y, 14);
          const ts = bm.timestamp ? '  (' + new Date(bm.timestamp).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + ')' : '';
          y = drawRunHeader(`Benchmark Run ${bi + 1} of ${effectiveBMs.length}${ts}  ·  ${(data.test_samples||0).toLocaleString()} test samples`, y);
        } else {
          doc.setFontSize(8.5); doc.setFont('helvetica','normal'); doc.setTextColor(...C.mid);
          doc.text(`Evaluated on ${(data.test_samples||0).toLocaleString()} test samples  ·  Fixed test set (seed=42)`, ML, y);
          y += 10;
        }

        if (bmModels.length > 0) {
          y = checkPageBreak(y, 24);
          y = drawSubHeader('Model Comparison Summary', y);
          const bmRows = bmModels.map(m => [
            m.label || m.short_label || '—',
            m.accuracy != null ? (m.accuracy*100).toFixed(2)+'%' : '—',
            m.loss     != null ? m.loss.toFixed(4) : '—',
            m.per_class_f1?.length        ? (_avg(m.per_class_f1)*100).toFixed(1)+'%'        : '—',
            m.per_class_precision?.length ? (_avg(m.per_class_precision)*100).toFixed(1)+'%' : '—',
            m.per_class_recall?.length    ? (_avg(m.per_class_recall)*100).toFixed(1)+'%'    : '—',
            m.num_params        != null ? _fmtParams(m.num_params)           : '—',
            m.inference_time_ms != null ? String(m.inference_time_ms)+' ms' : '—',
          ]);
          y = makeTable({
            startY: y,
            head: [['Model','Accuracy','Loss','Avg F1','Avg Prec','Avg Rec','Params','Time']],
            body: bmRows, margin: { left: ML, right: MR },
            columnStyles: {
              0:{cellWidth:CW*0.28}, 1:{cellWidth:CW*0.10,halign:'right'}, 2:{cellWidth:CW*0.10,halign:'right'},
              3:{cellWidth:CW*0.10,halign:'right'}, 4:{cellWidth:CW*0.10,halign:'right'}, 5:{cellWidth:CW*0.10,halign:'right'},
              6:{cellWidth:CW*0.12,halign:'right'}, 7:{cellWidth:CW*0.10,halign:'right'},
            },
          });
        }

        // Charts — only on benchmark page
        if (bi === 0 && document.getElementById('bm-chart-acc')) {
          y = checkPageBreak(y, 68);
          doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...C.navy);
          doc.text('Figure 5 — Overall Accuracy', ML, y);
          doc.text('Figure 6 — Inference Time (ms)', ML + CW/2 + 4, y);
          y += 4;
          addChartImage('bm-chart-acc',  ML,             y, CW/2-4, 52);
          addChartImage('bm-chart-time', ML + CW/2 + 4,  y, CW/2-4, 52);
          y += 58;
          y = checkPageBreak(y, 68);
          doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...C.navy);
          doc.text('Figure 7 — Multi-Metric Radar', ML, y);
          doc.text('Figure 8 — Per-Class Accuracy', ML + CW/2 + 4, y);
          y += 4;
          addChartImage('bm-chart-radar',     ML,             y, CW/2-4, 56);
          addChartImage('bm-chart-class-acc', ML + CW/2 + 4,  y, CW/2-4, 56);
          y += 62;
          y = checkPageBreak(y, 68);
          doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...C.navy);
          doc.text('Figure 9 — Per-Class F1 Score', ML, y); y += 4;
          addChartImage('bm-chart-f1', ML, y, CW, 54); y += 60;
        }

        // Per-model class detail
        bmModels.forEach((m, mi) => {
          if (!m.per_class_f1?.length) return;
          y = checkPageBreak(y, 40);
          doc.setFillColor(...C.rowAlt); doc.rect(ML, y, CW, 10, 'F');
          doc.setDrawColor(...C.rule); doc.setLineWidth(0.25); doc.rect(ML, y, CW, 10, 'S');
          doc.setFillColor(...C.navy); doc.rect(ML, y, 3, 10, 'F');
          doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...C.navy);
          doc.text(m.label || m.short_label || `Model ${mi+1}`, ML+7, y+6.8);
          doc.setFont('helvetica','normal'); doc.setTextColor(...C.mid);
          doc.text(`Accuracy: ${m.accuracy!=null?(m.accuracy*100).toFixed(2)+'%':'—'}   Loss: ${m.loss!=null?m.loss.toFixed(4):'—'}`, PW-MR, y+6.8, { align:'right' });
          y += 14;
          const pcRows = bmClasses.map((cls, ci) => [
            cls,
            m.per_class_accuracy?.[ci]  != null ? (m.per_class_accuracy[ci]*100).toFixed(1)+'%'  : '—',
            m.per_class_f1?.[ci]        != null ? (m.per_class_f1[ci]*100).toFixed(1)+'%'        : '—',
            m.per_class_precision?.[ci] != null ? (m.per_class_precision[ci]*100).toFixed(1)+'%' : '—',
            m.per_class_recall?.[ci]    != null ? (m.per_class_recall[ci]*100).toFixed(1)+'%'    : '—',
          ]);
          y = makeTable({
            startY: y, head: [['Class','Accuracy','F1 Score','Precision','Recall']],
            body: pcRows, margin: { left:ML, right:MR },
            columnStyles: { 0:{cellWidth:CW*0.22}, 1:{cellWidth:CW*0.19,halign:'right'}, 2:{cellWidth:CW*0.19,halign:'right'}, 3:{cellWidth:CW*0.20,halign:'right'}, 4:{cellWidth:CW*0.20,halign:'right'} },
          });
          if (m.confusion_matrix?.length) {
            const n=m.confusion_matrix.length, cellSz=Math.min(18,(CW*0.5)/n);
            y = checkPageBreak(y, 8+n*cellSz+20);
            y = drawSubHeader(`Confusion Matrix — ${m.short_label||m.label||''}`, y);
            y = drawConfusionMatrix(m.confusion_matrix, bmClasses, ML, y, cellSz);
          }
          y += 8;
        });
        y += 8;
      });
    } // end hasBenchmark

    // ── Footers ───────────────────────────────────────────────────────────────
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); drawFooter(p, totalPages); }

    const ts2 = generatedAt.toISOString().slice(0,19).replace(/[:T]/g,'-');
    doc.save(`BearingFL_Session_Report_${ts2}.pdf`);

  } catch (err) {
    console.error('Report generation error:', err);
    alert('Failed to generate report: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      // Restore icon + text (without wiping children — keep the badge span if present)
      const svgHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg> Report`;
      btn.innerHTML = svgHtml;
    }
    // Restore badge count (regenerates badge from current session state)
    if (typeof _updateSessionBadge === 'function') _updateSessionBadge();
  }
}
