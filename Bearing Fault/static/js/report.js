'use strict';

// ──────────────────────────────────────────────────────────────────────────────
//  BearingFL PDF Report Generator
//  Uses jsPDF + jsPDF-autoTable (loaded as window.jspdf)
// ──────────────────────────────────────────────────────────────────────────────

async function generateReport() {
  const btn = document.getElementById('btn-report');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // ── Page dimensions & layout constants ────────────────────────────────────
    const PW = 210;   // page width  mm
    const PH = 297;   // page height mm
    const ML = 18;    // margin left
    const MR = 18;    // margin right
    const MT = 20;    // margin top
    const CW = PW - ML - MR;  // content width

    // ── Color palette ─────────────────────────────────────────────────────────
    const C = {
      indigo:   [79,  70,  229],
      dark:     [15,  23,  42],
      text:     [30,  41,  59],
      muted:    [100, 116, 139],
      faint:    [148, 163, 184],
      white:    [255, 255, 255],
      offwhite: [248, 250, 252],
      border:   [226, 232, 240],
      rowAlt:   [241, 245, 249],
      red:      [248, 113, 113],
      green:    [74,  222, 128],
      amber:    [251, 191,  36],
      teal:     [52,  211, 153],
    };

    // Class colours (match CLASS_COLORS in app.js)
    const CLASS_HEX = ['#60a5fa','#f87171','#fbbf24','#34d399'];
    function hexToRgb(hex) {
      const h = hex.replace('#','');
      return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
    }
    const CLASS_RGB = CLASS_HEX.map(hexToRgb);

    // ── Snapshot the data we'll use ────────────────────────────────────────────
    const generatedAt    = new Date();
    const lossData       = (STATE.charts.loss?.data?.datasets?.[0]?.data) || [];
    const accData        = (STATE.charts.acc?.data?.datasets?.[0]?.data)  || [];
    const hasTrained     = lossData.length > 0;
    const cfg            = STATE.lastTrainingConfig || {};
    const classNames     = (STATE.lastConfusionMatrix?.classNames) || CLASS_NAMES || ['Normal','IR','OR','Ball'];
    const cmData         = STATE.lastConfusionMatrix?.cm || null;
    const predData       = STATE.lastPredictionData  || null;
    const bmData         = STATE.lastBenchmarkData   || null;

    // ── Helper: section counter ────────────────────────────────────────────────
    let sectionNum = 0;
    function nextSection() { return ++sectionNum; }

    // ── Helper: draw page background ──────────────────────────────────────────
    function drawPageBg() {
      doc.setFillColor(...C.dark);
      doc.rect(0, 0, PW, PH, 'F');
    }

    // ── Helper: draw footer on a specific page ─────────────────────────────────
    function drawFooter(pageNum, totalPages) {
      const y = PH - 10;
      doc.setDrawColor(...C.indigo);
      doc.setLineWidth(0.3);
      doc.line(ML, y - 4, PW - MR, y - 4);
      doc.setFontSize(8);
      doc.setTextColor(...C.muted);
      doc.text('BearingFL — Federated Learning Report', ML, y);
      doc.text(generatedAt.toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }), PW/2, y, { align:'center' });
      doc.text(`Page ${pageNum} / ${totalPages}`, PW - MR, y, { align:'right' });
    }

    // ── Helper: section header bar ────────────────────────────────────────────
    function drawSectionHeader(title, y) {
      doc.setFillColor(...C.indigo);
      doc.roundedRect(ML, y, CW, 8, 1.5, 1.5, 'F');
      doc.setFontSize(10);
      doc.setFont('helvetica','bold');
      doc.setTextColor(...C.white);
      doc.text(title, ML + 4, y + 5.5);
      return y + 13;
    }

    // ── Helper: subsection label ──────────────────────────────────────────────
    function drawSubHeader(title, y) {
      doc.setFontSize(9);
      doc.setFont('helvetica','bold');
      doc.setTextColor(...C.faint);
      doc.text(title.toUpperCase(), ML, y);
      doc.setDrawColor(...C.indigo);
      doc.setLineWidth(0.4);
      doc.line(ML, y + 1.5, ML + doc.getTextWidth(title.toUpperCase()), y + 1.5);
      return y + 7;
    }

    // ── Helper: add a canvas chart image ──────────────────────────────────────
    function addChartImage(canvasId, x, y, w, h) {
      try {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const img = canvas.toDataURL('image/png', 1.0);
        doc.setFillColor(...C.dark);
        doc.roundedRect(x, y, w, h, 2, 2, 'F');
        doc.addImage(img, 'PNG', x, y, w, h);
      } catch(e) { /* skip if canvas not ready */ }
    }

    // ── Helper: check page break ──────────────────────────────────────────────
    function checkPageBreak(y, needed) {
      if (y + needed > PH - 22) {
        doc.addPage();
        drawPageBg();
        return MT;
      }
      return y;
    }

    // ── Helper: stat card ─────────────────────────────────────────────────────
    function drawStatCard(x, y, w, h, label, value, color) {
      doc.setFillColor(...C.text);
      doc.roundedRect(x, y, w, h, 2, 2, 'F');
      doc.setDrawColor(...(color || C.indigo));
      doc.setLineWidth(0.5);
      doc.roundedRect(x, y, w, h, 2, 2, 'S');
      doc.setFontSize(8);
      doc.setFont('helvetica','normal');
      doc.setTextColor(...C.faint);
      doc.text(label, x + w/2, y + 5.5, { align:'center' });
      doc.setFontSize(13);
      doc.setFont('helvetica','bold');
      doc.setTextColor(...(color || C.white));
      doc.text(value, x + w/2, y + 13, { align:'center' });
    }

    // ── Helper: autoTable wrapper ──────────────────────────────────────────────
    function makeTable(doc, opts) {
      doc.autoTable({
        theme: 'plain',
        styles: {
          fontSize: 8,
          cellPadding: { top:2, bottom:2, left:3, right:3 },
          textColor: C.faint,
          lineColor: C.border,
          lineWidth: 0.15,
          fillColor: C.dark,
          font: 'helvetica',
        },
        headStyles: {
          fillColor: C.indigo,
          textColor: C.white,
          fontStyle: 'bold',
          fontSize: 8,
        },
        alternateRowStyles: { fillColor: C.text },
        ...opts,
      });
      return doc.lastAutoTable.finalY + 6;
    }

    // ── Helper: draw confusion matrix as colored grid ─────────────────────────
    function drawConfusionMatrix(cm, names, x, y, cellSize) {
      const n = cm.length;
      const gridW = cellSize * n;
      const labelW = 14;
      const fullW = labelW + gridW;

      // True\Predicted label
      doc.setFontSize(6.5);
      doc.setFont('helvetica','normal');
      doc.setTextColor(...C.muted);
      doc.text('TRUE \\ PRED', x, y - 2);

      // Column labels
      names.forEach((name, j) => {
        doc.setFontSize(6.5);
        doc.setFont('helvetica','bold');
        doc.setTextColor(...C.faint);
        doc.text(name, x + labelW + j * cellSize + cellSize/2, y + 3, { align:'center' });
      });

      const maxVal = Math.max(...cm.flat(), 1);

      cm.forEach((row, i) => {
        // Row label
        doc.setFontSize(6.5);
        doc.setFont('helvetica','bold');
        doc.setTextColor(...C.faint);
        doc.text(names[i], x + labelW - 1, y + 8 + i * cellSize + cellSize/2, { align:'right' });

        row.forEach((val, j) => {
          const t = maxVal > 0 ? val / maxVal : 0;
          // Interpolate between dark [30,41,59] and indigo [99,102,241]
          const r = Math.round(30  + (99  - 30)  * t);
          const g = Math.round(41  + (102 - 41)  * t);
          const b = Math.round(59  + (241 - 59)  * t);

          const cx2 = x + labelW + j * cellSize;
          const cy2 = y + 8      + i * cellSize;

          doc.setFillColor(r, g, b);
          doc.rect(cx2, cy2, cellSize, cellSize, 'F');

          // Diagonal border
          if (i === j) {
            doc.setDrawColor(...C.white);
            doc.setLineWidth(0.5);
            doc.rect(cx2 + 0.3, cy2 + 0.3, cellSize - 0.6, cellSize - 0.6, 'S');
          }

          // Cell text
          doc.setFontSize(t > 0.4 ? 7 : 6.5);
          doc.setFont('helvetica', i === j ? 'bold' : 'normal');
          doc.setTextColor(...(t > 0.4 ? C.white : C.faint));
          doc.text(String(val), cx2 + cellSize/2, cy2 + cellSize/2 + 2, { align:'center' });
        });
      });

      return y + 8 + n * cellSize + 4;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PAGE 1 — COVER
    // ══════════════════════════════════════════════════════════════════════════
    drawPageBg();

    // Top accent bar
    doc.setFillColor(...C.indigo);
    doc.rect(0, 0, PW, 3, 'F');

    // Title block
    let y = 38;
    doc.setFillColor(...C.text);
    doc.roundedRect(ML, y, CW, 52, 3, 3, 'F');
    doc.setDrawColor(...C.indigo);
    doc.setLineWidth(0.6);
    doc.roundedRect(ML, y, CW, 52, 3, 3, 'S');

    // BearingFL logo text
    doc.setFontSize(28);
    doc.setFont('helvetica','bold');
    doc.setTextColor(...C.white);
    doc.text('BearingFL', ML + CW/2, y + 16, { align:'center' });

    doc.setFontSize(11);
    doc.setFont('helvetica','normal');
    doc.setTextColor(...C.faint);
    doc.text('Federated Learning Dashboard — Experiment Report', ML + CW/2, y + 24, { align:'center' });

    doc.setDrawColor(...C.indigo);
    doc.setLineWidth(0.3);
    doc.line(ML + 20, y + 28, PW - MR - 20, y + 28);

    doc.setFontSize(9);
    doc.setTextColor(...C.muted);
    doc.text(`Generated: ${generatedAt.toLocaleString()}`, ML + CW/2, y + 35, { align:'center' });

    const modelLabel = cfg.model_type ? cfg.model_type.toUpperCase() : '—';
    const stratLabel = cfg.aggregation_strategy ? cfg.aggregation_strategy.toUpperCase() : '—';
    doc.text(`Model: ${modelLabel}  ·  Strategy: ${stratLabel}`, ML + CW/2, y + 42, { align:'center' });

    // Summary stat cards
    y += 60;
    const cardW = (CW - 12) / 4;
    const bestAccVal  = hasTrained ? ((STATE.bestAcc || 0) * 100).toFixed(1) + '%' : '—';
    const finalLoss   = hasTrained ? (lossData[lossData.length - 1] || 0).toFixed(4) : '—';
    const numRoundsV  = cfg.num_rounds ? String(cfg.num_rounds) : (STATE.numRounds ? String(STATE.numRounds) : '—');
    const numClients  = cfg.num_clients ? String(cfg.num_clients) : '—';

    drawStatCard(ML,                  y, cardW, 20, 'Best Accuracy',  bestAccVal,  C.green);
    drawStatCard(ML + cardW + 4,      y, cardW, 20, 'Final Loss',     finalLoss,   C.red);
    drawStatCard(ML + (cardW+4)*2,    y, cardW, 20, 'FL Rounds',      numRoundsV,  C.indigo);
    drawStatCard(ML + (cardW+4)*3,    y, cardW, 20, 'Clients',        numClients,  [251,191,36]);

    // Table of contents
    y += 32;
    y = drawSectionHeader('Table of Contents', y);

    const sections = [
      { n: 1, title: 'Cover & Summary',           note: 'This page' },
      { n: 2, title: 'Experiment Configuration',  note: 'Hyperparameters and setup' },
      { n: 3, title: 'Training Results',          note: hasTrained ? 'Loss, accuracy, per-round history' : 'Not available — run training first' },
      { n: 4, title: 'Data Distribution & Evaluation', note: hasTrained ? 'Distribution chart, confusion matrix, client metrics' : 'Not available' },
      { n: 5, title: 'Prediction Results',        note: predData  ? 'Signal classification output' : 'Not available — run a prediction first' },
      { n: 6, title: 'Benchmark Comparison',      note: bmData    ? 'Multi-model evaluation' : 'Not available — run benchmark first' },
    ];

    doc.setFontSize(9);
    sections.forEach((s, i) => {
      const rowY = y + i * 9;
      if (i % 2 === 1) {
        doc.setFillColor(...C.text);
        doc.rect(ML, rowY - 3, CW, 9, 'F');
      }
      doc.setFont('helvetica','bold');
      doc.setTextColor(...C.white);
      doc.text(`${s.n}.`, ML + 4, rowY + 3);
      doc.setFont('helvetica','normal');
      doc.setTextColor(...C.faint);
      doc.text(s.title, ML + 12, rowY + 3);
      doc.setTextColor(...C.muted);
      doc.text(s.note, ML + CW - 4, rowY + 3, { align:'right' });
    });

    // ══════════════════════════════════════════════════════════════════════════
    //  PAGE 2 — EXPERIMENT CONFIGURATION
    // ══════════════════════════════════════════════════════════════════════════
    doc.addPage();
    drawPageBg();
    y = MT;
    y = drawSectionHeader(`${nextSection()}. Experiment Configuration`, y);

    if (Object.keys(cfg).length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(...C.muted);
      doc.text('No configuration captured. Start a training session first.', ML, y + 6);
      y += 14;
    } else {
      // Two-column layout
      const halfW = (CW - 8) / 2;
      const leftX  = ML;
      const rightX = ML + halfW + 8;

      const yStart = y;

      // ── Left column: Data Partitioning ────────────────────────────────────
      doc.setFontSize(8.5);
      doc.setFont('helvetica','bold');
      doc.setTextColor(...C.faint);
      doc.text('Data Partitioning', leftX, yStart);

      const partRows = [
        ['Clients',             String(cfg.num_clients ?? '—')],
        ['Partition Strategy',  String(cfg.partition_strategy ?? '—')],
        ['Dirichlet Alpha',     String(cfg.dirichlet_alpha ?? '—')],
      ];
      doc.autoTable({
        startY: yStart + 4,
        head: [['Parameter','Value']],
        body: partRows,
        theme: 'plain',
        styles: { fontSize:8, cellPadding:{top:2,bottom:2,left:3,right:3}, textColor:C.faint, lineColor:C.border, lineWidth:0.15, fillColor:C.dark },
        headStyles: { fillColor:C.indigo, textColor:C.white, fontStyle:'bold', fontSize:8 },
        alternateRowStyles: { fillColor:C.text },
        margin: { left: leftX, right: rightX + halfW - ML },
        tableWidth: halfW,
      });
      const leftY1 = doc.lastAutoTable.finalY + 6;

      // ── Right column: Federated Learning ──────────────────────────────────
      doc.setFontSize(8.5);
      doc.setFont('helvetica','bold');
      doc.setTextColor(...C.faint);
      doc.text('Federated Learning', rightX, yStart);

      const flRows = [
        ['Rounds',               String(cfg.num_rounds ?? '—')],
        ['Fraction Fit',         String(cfg.fraction_fit ?? '—')],
        ['Aggregation',          String(cfg.aggregation_strategy ?? '—')],
        ['FedProx Mu',           String(cfg.fedprox_mu ?? '—')],
        ['Early Stop Patience',  String(cfg.early_stopping_patience ?? '—')],
      ];
      doc.autoTable({
        startY: yStart + 4,
        head: [['Parameter','Value']],
        body: flRows,
        theme: 'plain',
        styles: { fontSize:8, cellPadding:{top:2,bottom:2,left:3,right:3}, textColor:C.faint, lineColor:C.border, lineWidth:0.15, fillColor:C.dark },
        headStyles: { fillColor:C.indigo, textColor:C.white, fontStyle:'bold', fontSize:8 },
        alternateRowStyles: { fillColor:C.text },
        margin: { left: rightX, right: MR },
        tableWidth: halfW,
      });
      const rightY1 = doc.lastAutoTable.finalY + 6;

      y = Math.max(leftY1, rightY1) + 4;

      // Second row of columns
      const yStart2 = y;

      // ── Left column 2: Local Training ─────────────────────────────────────
      doc.setFontSize(8.5);
      doc.setFont('helvetica','bold');
      doc.setTextColor(...C.faint);
      doc.text('Local Training', leftX, yStart2);

      const localRows = [
        ['Local Epochs',     String(cfg.local_epochs ?? '—')],
        ['Batch Size',       String(cfg.batch_size ?? '—')],
        ['Learning Rate',    String(cfg.learning_rate ?? '—')],
        ['Optimizer',        String(cfg.optimizer ?? '—')],
        ['LR Scheduler',     String(cfg.lr_scheduler ?? '—')],
        ['Weight Decay',     String(cfg.weight_decay ?? '—')],
        ['Gradient Clip',    String(cfg.grad_clip ?? '—')],
        ['Label Smoothing',  String(cfg.label_smoothing ?? '—')],
        ['Augmentation',     cfg.use_augmentation ? 'Enabled' : 'Disabled'],
        ['Noise Std Dev',    cfg.use_augmentation ? String(cfg.aug_noise_std ?? '—') : 'N/A'],
      ];
      doc.autoTable({
        startY: yStart2 + 4,
        head: [['Parameter','Value']],
        body: localRows,
        theme: 'plain',
        styles: { fontSize:8, cellPadding:{top:2,bottom:2,left:3,right:3}, textColor:C.faint, lineColor:C.border, lineWidth:0.15, fillColor:C.dark },
        headStyles: { fillColor:C.indigo, textColor:C.white, fontStyle:'bold', fontSize:8 },
        alternateRowStyles: { fillColor:C.text },
        margin: { left: leftX, right: rightX + halfW - ML },
        tableWidth: halfW,
      });
      const leftY2 = doc.lastAutoTable.finalY + 6;

      // ── Right column 2: Model Architecture ────────────────────────────────
      doc.setFontSize(8.5);
      doc.setFont('helvetica','bold');
      doc.setTextColor(...C.faint);
      doc.text('Model Architecture', rightX, yStart2);

      const modelRows = [
        ['Model Type',   String(cfg.model_type ?? '—')],
        ['Dropout',      String(cfg.dropout ?? '—')],
        ['Random Seed',  String(cfg.seed ?? '—')],
      ];
      doc.autoTable({
        startY: yStart2 + 4,
        head: [['Parameter','Value']],
        body: modelRows,
        theme: 'plain',
        styles: { fontSize:8, cellPadding:{top:2,bottom:2,left:3,right:3}, textColor:C.faint, lineColor:C.border, lineWidth:0.15, fillColor:C.dark },
        headStyles: { fillColor:C.indigo, textColor:C.white, fontStyle:'bold', fontSize:8 },
        alternateRowStyles: { fillColor:C.text },
        margin: { left: rightX, right: MR },
        tableWidth: halfW,
      });
      const rightY2 = doc.lastAutoTable.finalY + 6;

      y = Math.max(leftY2, rightY2);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PAGE 3+ — TRAINING RESULTS
    // ══════════════════════════════════════════════════════════════════════════
    doc.addPage();
    drawPageBg();
    y = MT;
    y = drawSectionHeader(`${nextSection()}. Training Results`, y);

    if (!hasTrained) {
      doc.setFontSize(9);
      doc.setTextColor(...C.muted);
      doc.text('No training data available. Run a training session first.', ML, y + 6);
      y += 14;
    } else {
      // Stat cards row
      const cardW2 = (CW - 8) / 3;
      const finalAcc  = accData.length  > 0 ? ((accData[accData.length-1] || 0)*100).toFixed(2)+'%' : '—';
      const finalLoss2= lossData.length > 0 ? (lossData[lossData.length-1] || 0).toFixed(4) : '—';
      const bestAccStr= ((STATE.bestAcc || 0)*100).toFixed(2)+'%';

      drawStatCard(ML,               y, cardW2, 20, 'Final Accuracy', finalAcc,   C.green);
      drawStatCard(ML+cardW2+4,      y, cardW2, 20, 'Final Loss',     finalLoss2, C.red);
      drawStatCard(ML+(cardW2+4)*2,  y, cardW2, 20, 'Best Accuracy',  bestAccStr, C.indigo);
      y += 28;

      // Loss chart
      y = checkPageBreak(y, 62);
      doc.setFontSize(8.5);
      doc.setFont('helvetica','bold');
      doc.setTextColor(...C.faint);
      doc.text('Global Loss per Round', ML, y);
      y += 4;
      addChartImage('chart-loss', ML, y, CW/2 - 4, 54);

      // Accuracy chart
      doc.setFontSize(8.5);
      doc.setFont('helvetica','bold');
      doc.setTextColor(...C.faint);
      doc.text('Global Accuracy per Round', ML + CW/2 + 4, y - 4);
      addChartImage('chart-acc', ML + CW/2 + 4, y, CW/2 - 4, 54);
      y += 58;

      // Per-client chart
      y = checkPageBreak(y, 62);
      doc.setFontSize(8.5);
      doc.setFont('helvetica','bold');
      doc.setTextColor(...C.faint);
      doc.text('Per-Client Validation Accuracy', ML, y);
      y += 4;
      addChartImage('chart-clients', ML, y, CW, 52);
      y += 56;

      // Training history table (per-round)
      y = checkPageBreak(y, 30);
      y = drawSubHeader('Round-by-Round Training History', y);

      const rounds = lossData.length;
      const histRows = [];
      for (let i = 0; i < rounds; i++) {
        const loss = lossData[i];
        const acc  = accData[i];
        histRows.push([
          String(i + 1),
          loss != null ? loss.toFixed(4) : '—',
          acc  != null ? (acc * 100).toFixed(2) + '%' : '—',
          i === rounds - 1 ? 'Final' : '',
        ]);
      }

      y = makeTable(doc, {
        startY: y,
        head: [['Round','Loss','Accuracy','Note']],
        body: histRows,
        margin: { left: ML, right: MR },
        columnStyles: {
          0: { cellWidth: 20, halign:'center' },
          1: { cellWidth: 30, halign:'right'  },
          2: { cellWidth: 35, halign:'right'  },
          3: { cellWidth: CW - 85, halign:'center' },
        },
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PAGE — DATA DISTRIBUTION & EVALUATION
    // ══════════════════════════════════════════════════════════════════════════
    doc.addPage();
    drawPageBg();
    y = MT;
    y = drawSectionHeader(`${nextSection()}. Data Distribution & Evaluation`, y);

    if (!hasTrained) {
      doc.setFontSize(9);
      doc.setTextColor(...C.muted);
      doc.text('Not available — complete a training session first.', ML, y + 6);
      y += 14;
    } else {
      // Distribution chart
      doc.setFontSize(8.5);
      doc.setFont('helvetica','bold');
      doc.setTextColor(...C.faint);
      doc.text('Data Distribution per Client', ML, y);
      y += 4;
      addChartImage('chart-dist', ML, y, CW, 56);
      y += 60;

      // Class legend
      y = checkPageBreak(y, 12);
      const lgdW = CW / classNames.length;
      classNames.forEach((name, i) => {
        const lx = ML + i * lgdW;
        doc.setFillColor(...CLASS_RGB[i]);
        doc.circle(lx + 3, y + 2, 2, 'F');
        doc.setFontSize(8);
        doc.setFont('helvetica','normal');
        doc.setTextColor(...C.faint);
        doc.text(name, lx + 7, y + 4);
      });
      y += 10;

      // Confusion matrix
      if (cmData) {
        y = checkPageBreak(y, 60);
        y = drawSubHeader('Final Confusion Matrix', y);

        const n       = cmData.length;
        const cellSz  = Math.min(18, (CW * 0.55) / n);
        y = drawConfusionMatrix(cmData, classNames, ML, y, cellSz);

        // Per-class accuracy row
        y = checkPageBreak(y, 20);
        const perClassW = CW / n;
        classNames.forEach((name, i) => {
          const total = cmData[i].reduce((a,b) => a+b, 0);
          const pct   = total > 0 ? ((cmData[i][i]/total)*100).toFixed(1)+'%' : '—';
          const pcX   = ML + i * perClassW;
          doc.setFontSize(8);
          doc.setFont('helvetica','normal');
          doc.setTextColor(...C.muted);
          doc.text(name, pcX + perClassW/2, y + 4, { align:'center' });
          doc.setFontSize(12);
          doc.setFont('helvetica','bold');
          doc.setTextColor(...CLASS_RGB[i]);
          doc.text(pct, pcX + perClassW/2, y + 12, { align:'center' });
        });
        y += 18;
      }

      // Client metrics table from last round
      const clientRows = [];
      const tbody = document.getElementById('client-tbody');
      if (tbody) {
        Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
          const cells = Array.from(tr.querySelectorAll('td'));
          if (cells.length >= 7) {
            clientRows.push(cells.slice(0, 7).map(c => c.textContent.trim()));
          }
        });
      }

      if (clientRows.length > 0) {
        y = checkPageBreak(y, 30);
        y = drawSubHeader('Client Metrics — Latest Round', y);
        y = makeTable(doc, {
          startY: y,
          head: [['Client','Train Loss','Train Acc','Val Loss','Val Acc','Samples','Steps']],
          body: clientRows,
          margin: { left: ML, right: MR },
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PAGE — PREDICTION RESULTS
    // ══════════════════════════════════════════════════════════════════════════
    if (predData) {
      doc.addPage();
      drawPageBg();
      y = MT;
      y = drawSectionHeader(`${nextSection()}. Prediction Results`, y);

      const predictions = predData.predictions || [];
      const ensemble    = predData.ensemble    || null;
      const nWin        = predData.num_windows || 1;

      // Summary line
      doc.setFontSize(9);
      doc.setFont('helvetica','normal');
      doc.setTextColor(...C.muted);
      doc.text(`${nWin} window${nWin!==1?'s':''} analysed · ${predictions.length} model${predictions.length!==1?'s':''}`, ML, y);
      y += 10;

      // Ensemble result
      if (ensemble) {
        y = checkPageBreak(y, 22);
        doc.setFillColor(...C.text);
        doc.roundedRect(ML, y, CW, 20, 2, 2, 'F');
        doc.setDrawColor(...C.indigo);
        doc.setLineWidth(0.5);
        doc.roundedRect(ML, y, CW, 20, 2, 2, 'S');

        doc.setFontSize(9);
        doc.setFont('helvetica','bold');
        doc.setTextColor(...C.faint);
        doc.text('Ensemble Decision', ML + 4, y + 7);
        doc.setFontSize(13);
        doc.setTextColor(...C.white);
        doc.text(ensemble.class_name || '—', ML + 4, y + 15);
        const voteStr = classNames.map(n => `${n}: ${ensemble.votes?.[n] ?? 0}`).join('  |  ');
        doc.setFontSize(8);
        doc.setFont('helvetica','normal');
        doc.setTextColor(...C.muted);
        doc.text(`Votes — ${voteStr}`, ML + CW - 4, y + 15, { align:'right' });
        y += 26;

        // Ensemble probability bars
        y = checkPageBreak(y, 8 * classNames.length + 8);
        y = drawSubHeader('Ensemble Class Probabilities', y);
        const barW = CW * 0.55;
        const barH = 5;
        classNames.forEach((name, i) => {
          const prob    = ensemble.probabilities?.[name] || 0;
          const pct     = (prob * 100).toFixed(1);
          const fillLen = barW * prob;

          doc.setFontSize(8);
          doc.setFont('helvetica','normal');
          doc.setTextColor(...C.faint);
          doc.text(name, ML, y + barH - 1);

          doc.setFillColor(...C.text);
          doc.roundedRect(ML + 20, y, barW, barH, 1, 1, 'F');
          doc.setFillColor(...CLASS_RGB[i]);
          if (fillLen > 0) doc.roundedRect(ML + 20, y, Math.max(fillLen, 1), barH, 1, 1, 'F');

          doc.setFontSize(8);
          doc.setTextColor(...CLASS_RGB[i]);
          doc.text(pct + '%', ML + 20 + barW + 3, y + barH - 1);

          y += 8;
        });
        y += 4;
      }

      // Per-model table
      if (predictions.length > 0) {
        y = checkPageBreak(y, 20);
        y = drawSubHeader('Per-Model Results', y);

        const pmRows = predictions.map(pm => {
          const dom = pm.dominant || {};
          return [
            pm.label || '—',
            dom.class_name || '—',
            dom.confidence != null ? (dom.confidence*100).toFixed(1)+'%' : '—',
            pm.best_accuracy != null ? (pm.best_accuracy*100).toFixed(1)+'%' : '—',
          ];
        });

        y = makeTable(doc, {
          startY: y,
          head: [['Model','Prediction','Confidence','Train Acc']],
          body: pmRows,
          margin: { left: ML, right: MR },
          columnStyles: {
            0: { cellWidth: CW * 0.45 },
            1: { cellWidth: CW * 0.2, halign:'center' },
            2: { cellWidth: CW * 0.18, halign:'right' },
            3: { cellWidth: CW * 0.17, halign:'right' },
          },
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PAGE — BENCHMARK RESULTS
    // ══════════════════════════════════════════════════════════════════════════
    if (bmData) {
      doc.addPage();
      drawPageBg();
      y = MT;
      y = drawSectionHeader(`${nextSection()}. Benchmark Comparison`, y);

      const bmModels    = bmData.models      || [];
      const bmClasses   = bmData.class_names || classNames;
      const testSamples = bmData.test_samples || 0;

      doc.setFontSize(8.5);
      doc.setFont('helvetica','normal');
      doc.setTextColor(...C.muted);
      doc.text(`Evaluated on ${testSamples.toLocaleString()} test samples (fixed test set, seed=42)`, ML, y);
      y += 10;

      // Summary table
      if (bmModels.length > 0) {
        y = checkPageBreak(y, 20);
        y = drawSubHeader('Summary Table', y);

        const bmRows = bmModels.map(m => [
          m.label || m.short_label || '—',
          (m.accuracy != null) ? (m.accuracy*100).toFixed(2)+'%' : '—',
          (m.loss     != null) ? m.loss.toFixed(4) : '—',
          (m.per_class_f1 && m.per_class_f1.length) ? (_avg(m.per_class_f1)*100).toFixed(1)+'%' : '—',
          (m.per_class_precision && m.per_class_precision.length) ? (_avg(m.per_class_precision)*100).toFixed(1)+'%' : '—',
          (m.per_class_recall && m.per_class_recall.length) ? (_avg(m.per_class_recall)*100).toFixed(1)+'%' : '—',
          m.num_params != null ? _fmtParams(m.num_params) : '—',
          m.inference_time_ms != null ? String(m.inference_time_ms)+'ms' : '—',
        ]);

        y = makeTable(doc, {
          startY: y,
          head: [['Model','Accuracy','Loss','Avg F1','Avg Prec','Avg Rec','Params','Time']],
          body: bmRows,
          margin: { left: ML, right: MR },
          columnStyles: {
            0: { cellWidth: CW * 0.28 },
            1: { cellWidth: CW * 0.10, halign:'right' },
            2: { cellWidth: CW * 0.10, halign:'right' },
            3: { cellWidth: CW * 0.10, halign:'right' },
            4: { cellWidth: CW * 0.10, halign:'right' },
            5: { cellWidth: CW * 0.10, halign:'right' },
            6: { cellWidth: CW * 0.12, halign:'right' },
            7: { cellWidth: CW * 0.10, halign:'right' },
          },
        });
      }

      // Benchmark charts
      y = checkPageBreak(y, 64);
      doc.setFontSize(8.5);
      doc.setFont('helvetica','bold');
      doc.setTextColor(...C.faint);
      doc.text('Overall Accuracy', ML, y);
      addChartImage('bm-chart-acc', ML, y + 4, CW/2 - 4, 52);

      doc.text('Inference Time (ms)', ML + CW/2 + 4, y);
      addChartImage('bm-chart-time', ML + CW/2 + 4, y + 4, CW/2 - 4, 52);
      y += 60;

      y = checkPageBreak(y, 64);
      doc.setFontSize(8.5);
      doc.setFont('helvetica','bold');
      doc.setTextColor(...C.faint);
      doc.text('Multi-Metric Radar', ML, y);
      addChartImage('bm-chart-radar', ML, y + 4, CW/2 - 4, 56);

      doc.text('Per-Class Accuracy', ML + CW/2 + 4, y);
      addChartImage('bm-chart-class-acc', ML + CW/2 + 4, y + 4, CW/2 - 4, 56);
      y += 64;

      y = checkPageBreak(y, 64);
      doc.setFontSize(8.5);
      doc.setFont('helvetica','bold');
      doc.setTextColor(...C.faint);
      doc.text('Per-Class F1 Score', ML, y);
      addChartImage('bm-chart-f1', ML, y + 4, CW, 54);
      y += 62;

      // Per-model per-class metrics tables
      bmModels.forEach((m, mi) => {
        if (!m.per_class_f1 || !m.per_class_f1.length) return;

        y = checkPageBreak(y, 36);
        const modelColor = [
          [129,140,248],[251,146,60],[167,139,250],[56,189,248],
          [251,191,36],[244,114,182],[74,222,128],[232,121,249],
        ][mi % 8];

        doc.setFillColor(...C.text);
        doc.roundedRect(ML, y, CW, 8, 1.5, 1.5, 'F');
        doc.setFillColor(...modelColor);
        doc.circle(ML + 6, y + 4, 2.5, 'F');
        doc.setFontSize(9);
        doc.setFont('helvetica','bold');
        doc.setTextColor(...C.white);
        doc.text(m.label || m.short_label || `Model ${mi+1}`, ML + 12, y + 5.5);
        doc.setFont('helvetica','normal');
        doc.setTextColor(...C.muted);
        doc.text(`Accuracy: ${m.accuracy != null ? (m.accuracy*100).toFixed(2)+'%' : '—'}  ·  Loss: ${m.loss != null ? m.loss.toFixed(4) : '—'}`, PW - MR, y + 5.5, { align:'right' });
        y += 12;

        // Per-class metrics table
        const pcRows = bmClasses.map((cls, ci) => [
          cls,
          m.per_class_accuracy?.[ci]  != null ? (m.per_class_accuracy[ci]*100).toFixed(1)+'%'  : '—',
          m.per_class_f1?.[ci]        != null ? (m.per_class_f1[ci]*100).toFixed(1)+'%'        : '—',
          m.per_class_precision?.[ci] != null ? (m.per_class_precision[ci]*100).toFixed(1)+'%' : '—',
          m.per_class_recall?.[ci]    != null ? (m.per_class_recall[ci]*100).toFixed(1)+'%'    : '—',
        ]);

        y = makeTable(doc, {
          startY: y,
          head: [['Class','Accuracy','F1','Precision','Recall']],
          body: pcRows,
          margin: { left: ML, right: MR },
          columnStyles: {
            0: { cellWidth: CW * 0.22 },
            1: { cellWidth: CW * 0.19, halign:'right' },
            2: { cellWidth: CW * 0.19, halign:'right' },
            3: { cellWidth: CW * 0.20, halign:'right' },
            4: { cellWidth: CW * 0.20, halign:'right' },
          },
        });

        // Confusion matrix for this model
        if (m.confusion_matrix && m.confusion_matrix.length > 0) {
          const n      = m.confusion_matrix.length;
          const cellSz = Math.min(16, (CW * 0.45) / n);
          const cmH    = 8 + n * cellSz + 12;
          y = checkPageBreak(y, cmH + 10);
          y = drawSubHeader(`Confusion Matrix — ${m.short_label || m.label || ''}`, y);
          y = drawConfusionMatrix(m.confusion_matrix, bmClasses, ML, y, cellSz);
        }

        y += 6;
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Add footers on every page
    // ══════════════════════════════════════════════════════════════════════════
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      drawFooter(p, totalPages);
    }

    // ── Save ──────────────────────────────────────────────────────────────────
    const ts = generatedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-');
    doc.save(`BearingFL_Report_${ts}.pdf`);

  } catch (err) {
    console.error('Report generation error:', err);
    alert('Failed to generate report: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg> Report`;
    }
  }
}
