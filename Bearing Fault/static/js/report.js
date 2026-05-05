'use strict';

// ──────────────────────────────────────────────────────────────────────────────
//  BearingFL — LaTeX Benchmark Report Generator
//  Builds a .tex document, sends to /api/report/compile, downloads the PDF.
// ──────────────────────────────────────────────────────────────────────────────

// ── LaTeX helpers ─────────────────────────────────────────────────────────────

function _tex(str) {
  if (str == null) return '---';
  return String(str)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g,  '\\&')
    .replace(/%/g,  '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g,  '\\#')
    .replace(/_/g,  '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g,  '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/</g,  '\\textless{}')
    .replace(/>/g,  '\\textgreater{}');
}

function _texInline(str) {
  return _tex(str).replace(/\\\*\\\*(.*?)\\\*\\\*/g, (_, m) => `\\textbf{${m}}`);
}

// Convert simple markdown (bold, headings, bullets) to LaTeX
function _md2tex(text) {
  if (!text) return '';
  const lines = text.split('\n');
  let out = '', inList = false;

  const closeList = () => { if (inList) { out += '\\end{itemize}\n\n'; inList = false; } };
  const inlineFmt = (s) => {
    // **bold**
    let r = _tex(s).replace(/\\\*\\\*(.*?)\\\*\\\*/g, (_, m) => `\\textbf{${m}}`);
    // ▸ prefix (from benchmark AI numbered list items)
    r = r.replace(/^▸\s*/, '\\textbullet{} ');
    return r;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); out += '\n'; continue; }

    // Heading (## or ### or **Bold line**)
    const mdH = line.trim().match(/^#{1,3}\s+(.+)/);
    const bH  = line.trim().match(/^\*\*([^*]+)\*\*\s*[:\-]?\s*$/);
    if (mdH || bH) {
      closeList();
      const title = inlineFmt((mdH ? mdH[1] : bH[1]).replace(/\*\*/g, ''));
      out += `\n\\medskip\\noindent{\\bfseries\\color{navy}${title}}\\par\\smallskip\n`;
      continue;
    }

    // Numbered heading (e.g. "1. **Title**")
    const numH = line.trim().match(/^(\d+)\.\s+\**(.+?)\**\s*$/);
    if (numH) {
      closeList();
      out += `\n\\medskip\\noindent{\\bfseries\\color{navy}${numH[1]}. ${inlineFmt(numH[2])}}\\par\\smallskip\n`;
      continue;
    }

    // Bullet
    const bul = line.match(/^(\s*)[•\-\*▸]\s+(.+)/);
    if (bul) {
      if (!inList) { out += '\\begin{itemize}[leftmargin=1.4em,itemsep=1pt,topsep=2pt]\n'; inList = true; }
      out += `  \\item ${inlineFmt(bul[2])}\n`;
      continue;
    }

    // Normal paragraph line
    closeList();
    out += `${inlineFmt(line)}\n\n`;
  }
  closeList();
  return out;
}

// Format a table row as LaTeX (cells separated by & and ended with \\)
function _row(cells, bold) {
  const fmt = bold
    ? cells.map(c => `\\textbf{${_tex(c)}}`).join(' & ')
    : cells.map(c => _tex(c)).join(' & ');
  return fmt + ' \\\\\n';
}

// ── Canvas image capture ──────────────────────────────────────────────────────
function _captureChart(id) {
  try {
    const cv = document.getElementById(id);
    if (!cv) return null;
    return cv.toDataURL('image/png', 1.0);
  } catch (_) { return null; }
}

// ── LaTeX document template ───────────────────────────────────────────────────
function _buildLatex(data) {
  const {
    bmResult, bmModels, bmClasses, AI, histories,
    generatedAt, bmTimestamp, images,
  } = data;

  const bestM = bmModels.reduce((b, m) => (!b || (m.accuracy ?? 0) > (b.accuracy ?? 0) ? m : b), null);
  const fastM = bmModels.reduce((b, m) => (!b || (m.inference_time_ms ?? Infinity) < (b.inference_time_ms ?? Infinity) ? m : b), null);

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) : '---';
  const fmtPct  = (v) => v != null ? (v * 100).toFixed(2) + '\\%' : '---';
  const fmtPct1 = (v) => v != null ? (v * 100).toFixed(1) + '\\%' : '---';
  const fmtAvg  = (arr) => arr?.length ? fmtPct1(arr.reduce((a, b) => a + b, 0) / arr.length) : '---';
  const fmtPar  = (n) => {
    if (n == null) return '---';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  };

  // ── Preamble ────────────────────────────────────────────────────────────────
  let doc = String.raw`
\documentclass[11pt,a4paper]{article}

%% ── Encoding & fonts ──────────────────────────────────────────────────────────
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{helvet}
\renewcommand{\familydefault}{\sfdefault}
\usepackage{microtype}

%% ── Page layout ───────────────────────────────────────────────────────────────
\usepackage[top=25mm,bottom=22mm,left=20mm,right=20mm,headheight=14pt]{geometry}
\usepackage{parskip}
\setlength{\parindent}{0pt}
\setlength{\parskip}{5pt plus 1pt}

%% ── Colours ───────────────────────────────────────────────────────────────────
\usepackage[table]{xcolor}
\definecolor{navy}{RGB}{15,23,42}
\definecolor{navylight}{RGB}{51,65,85}
\definecolor{green}{RGB}{16,185,129}
\definecolor{greendk}{RGB}{4,120,87}
\definecolor{greenbg}{RGB}{240,253,247}
\definecolor{recbg}{RGB}{232,252,244}
\definecolor{mid}{RGB}{100,116,139}
\definecolor{rowA}{RGB}{248,250,252}
\definecolor{rowB}{RGB}{255,255,255}
\definecolor{border}{RGB}{220,226,235}

%% ── Tables ─────────────────────────────────────────────────────────────────────
\usepackage{booktabs}
\usepackage{array}
\usepackage{colortbl}
\usepackage{longtable}
\usepackage{tabularx}
\usepackage{multirow}
\renewcommand{\arraystretch}{1.35}
\setlength{\tabcolsep}{6pt}

%% ── Graphics ──────────────────────────────────────────────────────────────────
\usepackage{graphicx}
\usepackage{float}

%% ── Lists ─────────────────────────────────────────────────────────────────────
\usepackage{enumitem}
\setlist[itemize]{leftmargin=1.4em,itemsep=1pt,topsep=3pt,parsep=0pt}

%% ── Boxes ─────────────────────────────────────────────────────────────────────
\usepackage[most,breakable]{tcolorbox}

%% AI analysis block
\tcbset{
  aibox/.style={
    breakable, enhanced,
    colback=greenbg, colframe=green,
    leftrule=3pt, rightrule=0pt, toprule=0pt, bottomrule=0pt,
    arc=0pt, outer arc=0pt,
    boxsep=3pt, left=6pt, right=6pt, top=5pt, bottom=5pt,
    fontupper=\small\color{navy},
    before upper={\setlength{\parskip}{4pt}},
    before={\vspace{6pt}},
    after={\vspace{6pt}},
  }
}

%% Recommendation card
\tcbset{
  recbox/.style={
    breakable, enhanced,
    colback=recbg, colframe=green,
    leftrule=4pt, rightrule=0pt, toprule=0pt, bottomrule=0pt,
    arc=0pt, outer arc=0pt,
    boxsep=3pt, left=8pt, right=6pt, top=7pt, bottom=7pt,
    before={\vspace{4pt}},
    after={\vspace{8pt}},
  }
}

%% ── Headers & footers ─────────────────────────────────────────────────────────
\usepackage{fancyhdr}
\pagestyle{fancy}
\fancyhf{}
\fancyhead[L]{\small\color{navylight}\textbf{BEARINGFL} \textnormal{\textcolor{mid}{\ $\cdot$\ Benchmark Report}}}
\fancyhead[R]{\small\color{mid}` + _tex(fmtDate(generatedAt)) + String.raw`}
\fancyfoot[L]{\small\color{mid}EFS Predictive Maintenance Platform}
\fancyfoot[C]{\small\color{mid}\thepage}
\fancyfoot[R]{\small\color{mid}Federated Learning · Bearing Fault Detection}
\renewcommand{\headrulewidth}{0.4pt}
\renewcommand{\footrulewidth}{0.4pt}

%% ── Section styling ───────────────────────────────────────────────────────────
\setlength{\fboxsep}{0pt}
\usepackage{titlesec}
\titleformat{\section}
  {\normalfont\large\bfseries\color{white}}
  {}
  {0em}
  {\colorbox{navy}{\makebox[\linewidth][l]{\strut\hspace{4pt}#1}}}
\titlespacing*{\section}{0pt}{18pt}{10pt}

\titleformat{\subsection}
  {\normalfont\normalsize\bfseries\color{navy}}
  {}
  {0em}
  {#1}
  [{\color{navy}\vspace{1pt}\hrule height 0.5pt\vspace{3pt}}]
\titlespacing*{\subsection}{0pt}{12pt}{4pt}

%% ── Custom macros ─────────────────────────────────────────────────────────────
% Stat card (inline, 4-up in a minipage row)
\newcommand{\statcard}[3]{%
  \begin{tcolorbox}[enhanced, colback=white, colframe=#3, arc=0pt,
    leftrule=3pt, rightrule=0pt, toprule=0pt, bottomrule=0pt,
    top=3pt, bottom=3pt, left=5pt, right=5pt, boxsep=0pt,
    width=\linewidth]
    \centering
    {\tiny\bfseries\color{mid}\uppercase{#1}}\\[3pt]
    {\large\bfseries\color{#3}#2}
  \end{tcolorbox}
}

%% ── Hyperlinks ────────────────────────────────────────────────────────────────
\usepackage[colorlinks=false,hidelinks,pdfborder={0 0 0}]{hyperref}

\begin{document}

%% ════════════════════════════════════════════════════════════════════════════
%%  COVER PAGE
%% ════════════════════════════════════════════════════════════════════════════
\thispagestyle{empty}

% Top accent bar
\noindent\colorbox{navy}{\parbox[b]{\linewidth}{\rule{0pt}{6pt}}}\\[-1pt]
\noindent\colorbox{green}{\parbox[b]{\linewidth}{\rule{0pt}{3pt}}}

\vspace{18mm}

% Logo + report type tag
\noindent
\begin{minipage}[c]{0.55\linewidth}
  {\tiny\color{mid}\bfseries BEARING FAULT DETECTION\ $\cdot$\ FEDERATED LEARNING PLATFORM}
\end{minipage}
\hfill
\begin{minipage}[c]{0.42\linewidth}
  \raggedleft
`;
  // Add logo if available
  if (images['logo.png']) {
    doc += String.raw`  \includegraphics[height=14mm]{logo.png}
`;
  }
  doc += String.raw`\end{minipage}

\vspace{12mm}

% Title
{\fontsize{28}{34}\selectfont\bfseries\color{navy} Benchmark Report}

\vspace{3mm}
{\color{green}\rule{\linewidth}{1.5pt}}
\vspace{1mm}
{\color{border}\rule{\linewidth}{0.4pt}}

\vspace{5mm}

{\large\color{mid} Bearing Fault Detection via Federated Learning}

\vspace{8mm}

% Metadata
{\small\color{mid}
\begin{tabular}{@{}ll@{}}
  Benchmark executed: & ` + _tex(fmtDate(bmTimestamp)) + (bmTimestamp ? ' at ' + _tex(new Date(bmTimestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })) : '') + String.raw` \\
  Models evaluated:   & ` + bmModels.length + String.raw` \\
  Test samples:       & ` + (bmResult.test_samples || 0).toLocaleString() + String.raw` \\
  Report generated:   & ` + _tex(fmtDate(generatedAt)) + ' at ' + _tex(new Date(generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })) + String.raw` \\
\end{tabular}
}

\vspace{10mm}

% Stat cards row
\noindent
\begin{minipage}[t]{0.235\linewidth}
  \statcard{Models Tested}{` + bmModels.length + String.raw`}{navy}
\end{minipage}\hfill
\begin{minipage}[t]{0.235\linewidth}
  \statcard{Best Accuracy}{` + (bestM ? (bestM.accuracy * 100).toFixed(1) + '\\%' : '---') + String.raw`}{green}
\end{minipage}\hfill
\begin{minipage}[t]{0.235\linewidth}
  \statcard{Fastest Inference}{` + (fastM ? fastM.inference_time_ms + ' ms' : '---') + String.raw`}{navy}
\end{minipage}\hfill
\begin{minipage}[t]{0.235\linewidth}
  \statcard{Histories Found}{` + Object.keys(histories).length + String.raw`}{navy}
\end{minipage}

\vspace{12mm}

{\color{navy}\hrule height 0.6pt}
\vspace{6mm}

% Table of contents
{\bfseries\large\color{navy} Contents}

\vspace{4mm}
\setlength{\extrarowheight}{3pt}
\begin{tabular}{@{}p{0.06\linewidth}p{0.86\linewidth}@{}}
  \rowcolor{rowA} \textbf{1} & Cover \& Benchmark Summary \\
  \rowcolor{rowB} \textbf{2} & Benchmark Comparison \\
`;
  if (Object.keys(histories).length > 0) {
    doc += String.raw`  \rowcolor{rowA} \textbf{3} & Model Training Histories \\
`;
  }
  doc += String.raw`\end{tabular}

\vfill

\noindent\colorbox{green}{\parbox[b]{\linewidth}{\rule{0pt}{2pt}}}\\[-1pt]
\noindent\colorbox{navy}{\parbox[b]{\linewidth}{\strut\hspace{4pt}%
  \textcolor{mid}{\tiny Powered by Flower Federated Learning\ $\cdot$\ flower.ai}%
  \hfill\textcolor{mid}{\tiny\thepage}%
  \strut}}

\clearpage

%% ════════════════════════════════════════════════════════════════════════════
%%  SECTION 2 — BENCHMARK COMPARISON
%% ════════════════════════════════════════════════════════════════════════════
\section{Benchmark Comparison}

`;

  // ── Recommendation card ──────────────────────────────────────────────────────
  if (AI['RECOMMENDATION']) {
    doc += String.raw`\subsection{Deployment Recommendation}

\begin{tcolorbox}[recbox]
\small
` + _md2tex(AI['RECOMMENDATION']) + String.raw`\end{tcolorbox}

`;
  }

  // ── Model architecture overview ──────────────────────────────────────────────
  if (AI['MODELS']) {
    doc += String.raw`\subsection{Model Architecture Overview}

\begin{tcolorbox}[aibox]
` + _md2tex(AI['MODELS']) + String.raw`\end{tcolorbox}

`;
  }

  // ── Executive summary ────────────────────────────────────────────────────────
  if (AI['SUMMARY']) {
    doc += String.raw`\subsection{Executive Summary}

\begin{tcolorbox}[aibox]
` + _md2tex(AI['SUMMARY']) + String.raw`\end{tcolorbox}

`;
  }

  // ── Comparison table ─────────────────────────────────────────────────────────
  if (bmModels.length > 0) {
    doc += String.raw`\subsection{Model Comparison --- Key Metrics}

{\small\color{mid} Fixed test set\ $\cdot$\ ` + (bmResult.test_samples || 0).toLocaleString() + String.raw` samples\ $\cdot$\ seed = 42}

\vspace{4pt}

\begin{table}[H]
\centering
\small
\rowcolors{2}{rowA}{rowB}
\begin{tabularx}{\linewidth}{@{}Xrrrrrrr@{}}
  \toprule
  \rowcolor{navylight}
  \textcolor{white}{\textbf{Model}} &
  \textcolor{white}{\textbf{Accuracy}} &
  \textcolor{white}{\textbf{Loss}} &
  \textcolor{white}{\textbf{Avg F1}} &
  \textcolor{white}{\textbf{Avg Prec.}} &
  \textcolor{white}{\textbf{Avg Rec.}} &
  \textcolor{white}{\textbf{Params}} &
  \textcolor{white}{\textbf{Infer.}} \\
  \midrule
`;
    for (const m of bmModels) {
      const isBest = bestM && m.model_id === bestM.model_id;
      const label = _tex(m.label || m.short_label || 'Unknown');
      const acc   = fmtPct(m.accuracy);
      const loss  = m.loss != null ? m.loss.toFixed(4) : '---';
      const f1    = fmtAvg(m.per_class_f1);
      const prec  = fmtAvg(m.per_class_precision);
      const rec   = fmtAvg(m.per_class_recall);
      const par   = fmtPar(m.num_params);
      const inf   = m.inference_time_ms != null ? m.inference_time_ms + ' ms' : '---';
      if (isBest) {
        doc += `  \\rowcolor{greenbg} \\textbf{${label}} & \\textbf{${acc}} & ${loss} & ${f1} & ${prec} & ${rec} & ${par} & ${inf} \\\\\n`;
      } else {
        doc += `  ${label} & ${acc} & ${loss} & ${f1} & ${prec} & ${rec} & ${par} & ${inf} \\\\\n`;
      }
    }
    doc += String.raw`  \bottomrule
\end{tabularx}
\end{table}

`;
    if (AI['TABLE']) {
      doc += String.raw`\begin{tcolorbox}[aibox]
` + _md2tex(AI['TABLE']) + String.raw`\end{tcolorbox}

`;
    }
  }

  // ── Charts ───────────────────────────────────────────────────────────────────
  const hasCharts = !!(images['chart_acc.png'] || images['chart_radar.png'] || images['chart_f1.png']);
  if (hasCharts) {
    if (images['chart_acc.png'] || images['chart_time.png']) {
      doc += String.raw`\subsection{Accuracy \& Inference Time}

\begin{figure}[H]
\centering
`;
      if (images['chart_acc.png'])  doc += String.raw`\begin{minipage}[t]{0.48\linewidth}
  \centering
  \includegraphics[width=\linewidth]{chart_acc.png}
  \small\color{mid}\textit{Figure 1 --- Overall Accuracy}
\end{minipage}\hfill
`;
      if (images['chart_time.png']) doc += String.raw`\begin{minipage}[t]{0.48\linewidth}
  \centering
  \includegraphics[width=\linewidth]{chart_time.png}
  \small\color{mid}\textit{Figure 2 --- Inference Time (ms)}
\end{minipage}
`;
      doc += String.raw`\end{figure}

`;
      if (AI['ACCURACY']) {
        doc += String.raw`\begin{tcolorbox}[aibox]
` + _md2tex(AI['ACCURACY']) + String.raw`\end{tcolorbox}

`;
      }
    }

    if (images['chart_radar.png'] || images['chart_class_acc.png']) {
      doc += String.raw`\subsection{Multi-Metric Radar \& Per-Class Accuracy}

\begin{figure}[H]
\centering
`;
      if (images['chart_radar.png'])     doc += String.raw`\begin{minipage}[t]{0.48\linewidth}
  \centering
  \includegraphics[width=\linewidth]{chart_radar.png}
  \small\color{mid}\textit{Figure 3 --- Multi-Metric Radar}
\end{minipage}\hfill
`;
      if (images['chart_class_acc.png']) doc += String.raw`\begin{minipage}[t]{0.48\linewidth}
  \centering
  \includegraphics[width=\linewidth]{chart_class_acc.png}
  \small\color{mid}\textit{Figure 4 --- Per-Class Accuracy}
\end{minipage}
`;
      doc += String.raw`\end{figure}

`;
      if (AI['RADAR']) {
        doc += String.raw`\begin{tcolorbox}[aibox]
` + _md2tex(AI['RADAR']) + String.raw`\end{tcolorbox}

`;
      }
    }

    if (images['chart_f1.png']) {
      doc += String.raw`\subsection{Per-Class F1 Score}

\begin{figure}[H]
\centering
\includegraphics[width=0.9\linewidth]{chart_f1.png}
\\ \small\color{mid}\textit{Figure 5 --- Per-Class F1 Score across Models}
\end{figure}

`;
      if (AI['F1']) {
        doc += String.raw`\begin{tcolorbox}[aibox]
` + _md2tex(AI['F1']) + String.raw`\end{tcolorbox}

`;
      }
    }
  }

  // ── Per-model class breakdown ─────────────────────────────────────────────────
  const detailModels = bmModels.filter(m => m.per_class_f1?.length);
  if (detailModels.length > 0) {
    doc += String.raw`\subsection{Per-Model Class Breakdown}

`;
    for (const m of bmModels) {
      if (!m.per_class_f1?.length) continue;
      const label = _tex(m.label || m.short_label || 'Unknown');
      doc += `{\\bfseries\\color{navylight}${label}}`;
      const meta = [
        m.accuracy != null ? `Accuracy: ${fmtPct(m.accuracy)}` : null,
        m.loss != null ? `Loss: ${m.loss.toFixed(4)}` : null,
        m.num_params != null ? `Params: ${fmtPar(m.num_params)}` : null,
        m.inference_time_ms != null ? `Infer.: ${m.inference_time_ms}\\,ms` : null,
      ].filter(Boolean).join('\\quad ');
      doc += `\\hfill{\\small\\color{mid}${meta}}\n\n`;
      doc += String.raw`\vspace{2pt}
\begin{table}[H]
\centering
\small
\rowcolors{2}{rowA}{rowB}
\begin{tabularx}{\linewidth}{@{}Xrrrr@{}}
  \toprule
  \rowcolor{navylight}
  \textcolor{white}{\textbf{Class}} &
  \textcolor{white}{\textbf{Accuracy}} &
  \textcolor{white}{\textbf{F1 Score}} &
  \textcolor{white}{\textbf{Precision}} &
  \textcolor{white}{\textbf{Recall}} \\
  \midrule
`;
      bmClasses.forEach((cls, ci) => {
        doc += `  ${_tex(cls)} & ${fmtPct1(m.per_class_accuracy?.[ci])} & ${fmtPct1(m.per_class_f1?.[ci])} & ${fmtPct1(m.per_class_precision?.[ci])} & ${fmtPct1(m.per_class_recall?.[ci])} \\\\\n`;
      });
      doc += String.raw`  \bottomrule
\end{tabularx}
\end{table}

`;
      // Confusion matrix as table
      if (m.confusion_matrix?.length) {
        const cm = m.confusion_matrix;
        const n  = cm.length;
        doc += `{\\small\\bfseries\\color{navy}Confusion Matrix --- ${_tex(m.short_label || m.label || '')}}\n\n`;
        doc += String.raw`\vspace{2pt}
\begin{table}[H]
\centering
\small
\begin{tabular}{@{}r|` + 'c'.repeat(n) + String.raw`@{}}
  \textit{Act.$\backslash$Pred.}`;
        bmClasses.forEach(c => { doc += ` & \\textbf{${_tex(c)}}`; });
        doc += ' \\\\\n  \\hline\n';
        const maxV = Math.max(...cm.flat(), 1);
        cm.forEach((row, i) => {
          doc += `  \\textbf{${_tex(bmClasses[i])}}`;
          row.forEach((v, j) => {
            const t = v / maxV;
            const intensity = Math.round(255 - (255 - 15) * t);
            const r = intensity, g = Math.round(255 - (255 - 23) * t), b = Math.round(255 - (255 - 42) * t);
            const hex = ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
            const textcol = t > 0.5 ? 'white' : 'navy';
            const cell = i === j ? `\\textbf{${v}}` : String(v);
            doc += ` & {\\cellcolor[HTML]{${hex}}\\color{${textcol}}${cell}}`;
          });
          doc += ' \\\\\n';
        });
        doc += String.raw`\end{tabular}
\end{table}

`;
      }
      doc += '\n';
    }
    if (AI['CONFUSION']) {
      doc += String.raw`\begin{tcolorbox}[aibox]
` + _md2tex(AI['CONFUSION']) + String.raw`\end{tcolorbox}

`;
    }
  }

  // ── Section 3: Model Training Histories ──────────────────────────────────────
  const histKeys = Object.keys(histories);
  if (histKeys.length > 0) {
    doc += String.raw`\clearpage
\section{Model Training Histories}

{\color{mid}\small Full federated-learning training records for each model evaluated in the benchmark above.}

\vspace{6pt}

`;
    for (const bm of bmModels) {
      const hist = histories[bm.model_id];
      if (!hist) continue;
      const cfg = hist.config || {};
      const tr  = hist.training || {};
      const ev  = hist.evaluation || {};
      const dd  = hist.data_distribution || {};
      const label = _tex(bm.label || bm.short_label || bm.model_id || 'Unknown');

      doc += `\\subsection{${label}}\n\n`;
      doc += `{\\small\\color{mid}Model ID: \\texttt{${_tex(bm.model_id || '---')}}}\n\n`;

      // Stat cards
      const bestAcc  = tr.best_accuracy  != null ? (tr.best_accuracy * 100).toFixed(2) + '\\%' : '---';
      const finLoss  = tr.final_loss     != null ? tr.final_loss.toFixed(4) : '---';
      const rounds   = String(tr.round_history?.length || cfg.num_rounds || '---');
      const trainT   = tr.total_elapsed_seconds != null ? (tr.total_elapsed_seconds / 60).toFixed(1) + ' min' : '---';

      doc += String.raw`\noindent
\begin{minipage}[t]{0.235\linewidth}
  \statcard{Best Accuracy}{` + bestAcc + String.raw`}{green}
\end{minipage}\hfill
\begin{minipage}[t]{0.235\linewidth}
  \statcard{Final Loss}{` + finLoss + String.raw`}{navy}
\end{minipage}\hfill
\begin{minipage}[t]{0.235\linewidth}
  \statcard{Total Rounds}{` + rounds + String.raw`}{navy}
\end{minipage}\hfill
\begin{minipage}[t]{0.235\linewidth}
  \statcard{Training Time}{` + trainT + String.raw`}{navy}
\end{minipage}

\vspace{8pt}

`;

      // Config tables (2 columns)
      doc += String.raw`{\bfseries\color{navy}\small Training Configuration}
{\color{navy}\vspace{1pt}\hrule height 0.5pt\vspace{4pt}}

\begin{minipage}[t]{0.48\linewidth}
\small
\rowcolors{2}{rowA}{rowB}
\begin{tabularx}{\linewidth}{@{}lX@{}}
  \toprule
  \rowcolor{navylight}\textcolor{white}{\textbf{Parameter}} & \textcolor{white}{\textbf{Value}} \\
  \midrule
  Model Type   & ` + _tex(cfg.model_type           ?? '---') + String.raw` \\
  FL Strategy  & ` + _tex(cfg.aggregation_strategy ?? '---') + String.raw` \\
  Clients      & ` + _tex(cfg.num_clients          ?? '---') + String.raw` \\
  FL Rounds    & ` + _tex(cfg.num_rounds           ?? '---') + String.raw` \\
  Local Epochs & ` + _tex(cfg.local_epochs         ?? '---') + String.raw` \\
  Partition    & ` + _tex(cfg.partition_strategy   ?? '---') + String.raw` \\
  \bottomrule
\end{tabularx}
\end{minipage}\hfill
\begin{minipage}[t]{0.48\linewidth}
\small
\rowcolors{2}{rowA}{rowB}
\begin{tabularx}{\linewidth}{@{}lX@{}}
  \toprule
  \rowcolor{navylight}\textcolor{white}{\textbf{Parameter}} & \textcolor{white}{\textbf{Value}} \\
  \midrule
  Batch Size      & ` + _tex(cfg.batch_size      ?? '---') + String.raw` \\
  Learning Rate   & ` + _tex(cfg.learning_rate   ?? '---') + String.raw` \\
  Optimizer       & ` + _tex(cfg.optimizer       ?? '---') + String.raw` \\
  LR Scheduler    & ` + _tex(cfg.lr_scheduler    ?? '---') + String.raw` \\
  Grad Clip       & ` + _tex(cfg.grad_clip       ?? '---') + String.raw` \\
  Label Smoothing & ` + _tex(cfg.label_smoothing ?? '---') + String.raw` \\
  \bottomrule
\end{tabularx}
\end{minipage}

\vspace{8pt}

`;

      // Round history table
      const roundsArr = tr.round_history || [];
      if (roundsArr.length > 0) {
        const step = Math.max(1, Math.floor(roundsArr.length / 30));
        const samp = roundsArr.filter((_, i) => i % step === 0 || i === roundsArr.length - 1);
        doc += `{\\bfseries\\color{navy}\\small Round-by-Round Training (${roundsArr.length} rounds`;
        if (step > 1) doc += `, every ${step}\\textsuperscript{th} shown`;
        doc += String.raw`)}
{\color{navy}\vspace{1pt}\hrule height 0.5pt\vspace{4pt}}

\small
\rowcolors{2}{rowA}{rowB}
\begin{longtable}{@{}rrrr@{}}
  \toprule
  \rowcolor{navylight}
  \textcolor{white}{\textbf{Round}} &
  \textcolor{white}{\textbf{Global Loss}} &
  \textcolor{white}{\textbf{Global Accuracy}} &
  \textcolor{white}{\textbf{Elapsed}} \\
  \midrule
  \endfirsthead
  \toprule
  \rowcolor{navylight}
  \textcolor{white}{\textbf{Round}} &
  \textcolor{white}{\textbf{Global Loss}} &
  \textcolor{white}{\textbf{Global Accuracy}} &
  \textcolor{white}{\textbf{Elapsed}} \\
  \midrule
  \endhead
  \bottomrule
  \endfoot
`;
        for (const r of samp) {
          const rnd  = r.round ?? r.round_num ?? '---';
          const loss = r.global_loss     != null ? r.global_loss.toFixed(4)               : (r.loss != null ? r.loss.toFixed(4) : '---');
          const acc  = r.global_accuracy != null ? (r.global_accuracy * 100).toFixed(2) + '\\%' : (r.acc != null ? (r.acc * 100).toFixed(2) + '\\%' : '---');
          const ela  = r.elapsed_seconds != null ? r.elapsed_seconds.toFixed(1) + '\\,s' : '---';
          doc += `  ${rnd} & ${loss} & ${acc} & ${ela} \\\\\n`;
        }
        doc += String.raw`\end{longtable}

`;
      }

      // Final evaluation
      if (ev.overall_accuracy != null || ev.overall_loss != null) {
        const evc = ev.class_names || bmClasses;
        doc += String.raw`{\bfseries\color{navy}\small Final Evaluation on Test Set}
{\color{navy}\vspace{1pt}\hrule height 0.5pt\vspace{4pt}}

\small
\rowcolors{2}{rowA}{rowB}
\begin{tabularx}{\linewidth}{@{}Xrrrr@{}}
  \toprule
  \rowcolor{navylight}
  \textcolor{white}{\textbf{Class}} &
  \textcolor{white}{\textbf{Accuracy}} &
  \textcolor{white}{\textbf{F1 Score}} &
  \textcolor{white}{\textbf{Precision}} &
  \textcolor{white}{\textbf{Recall}} \\
  \midrule
`;
        evc.forEach((cls, ci) => {
          doc += `  ${_tex(cls)} & ${fmtPct1(ev.per_class_accuracy?.[ci])} & ${fmtPct1(ev.per_class_f1?.[ci])} & ${fmtPct1(ev.per_class_precision?.[ci])} & ${fmtPct1(ev.per_class_recall?.[ci])} \\\\\n`;
        });
        doc += `  \\midrule\n`;
        doc += `  \\textbf{Overall} & \\textbf{${fmtPct(ev.overall_accuracy)}} & \\textbf{${fmtAvg(ev.per_class_f1)}} & \\textbf{${fmtAvg(ev.per_class_precision)}} & \\textbf{${fmtAvg(ev.per_class_recall)}} \\\\\n`;
        doc += String.raw`  \bottomrule
\end{tabularx}

`;
        // Confusion matrix
        if (ev.confusion_matrix?.length) {
          const cm = ev.confusion_matrix, n = cm.length;
          doc += `{\\small\\bfseries\\color{navy}Confusion Matrix}\n\n\\vspace{2pt}\n`;
          doc += `\\begin{table}[H]\\centering\\small\n\\begin{tabular}{@{}r|${'c'.repeat(n)}@{}}\n`;
          doc += `  \\textit{Act.\\textbackslash{}Pred.}`;
          evc.forEach(c => { doc += ` & \\textbf{${_tex(c)}}`; });
          doc += ' \\\\\n  \\hline\n';
          const maxV = Math.max(...cm.flat(), 1);
          cm.forEach((row, i) => {
            doc += `  \\textbf{${_tex(evc[i])}}`;
            row.forEach((v, j) => {
              const t = v / maxV;
              const ri = Math.round(255 - (255 - 15) * t), gi = Math.round(255 - (255 - 23) * t), bi = Math.round(255 - (255 - 42) * t);
              const hex = ((1 << 24) + (ri << 16) + (gi << 8) + bi).toString(16).slice(1);
              const textcol = t > 0.5 ? 'white' : 'navy';
              const cell = i === j ? `\\textbf{${v}}` : String(v);
              doc += ` & {\\cellcolor[HTML]{${hex}}\\color{${textcol}}${cell}}`;
            });
            doc += ' \\\\\n';
          });
          doc += '\\end{tabular}\n\\end{table}\n\n';
        }
      }

      // Data distribution
      const dc = dd.clients || [];
      if (dc.length > 0) {
        const dcls = dd.class_names || bmClasses;
        doc += `{\\bfseries\\color{navy}\\small Training Data Distribution per Client}\n{\\color{navy}\\vspace{1pt}\\hrule height 0.5pt\\vspace{4pt}}\n\n`;
        doc += `\\small\n\\rowcolors{2}{rowA}{rowB}\n\\begin{tabular}{@{}l${'r'.repeat(dcls.length)}@{}}\n`;
        doc += `  \\toprule\n  \\rowcolor{navylight}\\textcolor{white}{\\textbf{Client}}`;
        dcls.forEach(c => { doc += ` & \\textcolor{white}{\\textbf{${_tex(c)}}}`; });
        doc += ' \\\\\n  \\midrule\n';
        dc.forEach(c => {
          doc += `  Client ${c.client_id}`;
          dcls.forEach((_, ci) => { doc += ` & ${c.class_counts?.[String(ci)] ?? c.class_counts?.[ci] ?? 0}`; });
          doc += ' \\\\\n';
        });
        doc += '  \\bottomrule\n\\end{tabular}\n\n';
      }

      doc += '\n';
    }
  }

  doc += String.raw`\end{document}
`;
  return doc;
}

// ── Main entry point ──────────────────────────────────────────────────────────
async function generateReport() {
  const btn = document.getElementById('btn-report');
  if (btn) { btn.disabled = true; btn.innerHTML = 'Building LaTeX report…'; }

  try {
    // ── Resolve benchmark data ───────────────────────────────────────────────
    let freshSession = null;
    try { const r = localStorage.getItem('bearingfl_session'); if (r) freshSession = JSON.parse(r); } catch (_) {}
    const liveSession = (typeof STATE !== 'undefined' && STATE.session) ? STATE.session : null;
    const bmRuns = (() => {
      const a = liveSession?.benchmarkRuns || [], b = freshSession?.benchmarkRuns || [];
      return a.length >= b.length ? a : b;
    })();
    const lastBM = bmRuns.length > 0 ? bmRuns[bmRuns.length - 1]
      : ((typeof STATE !== 'undefined' && STATE.lastBenchmarkData)
          ? { timestamp: null, result: STATE.lastBenchmarkData } : null);

    if (!lastBM) {
      alert('No benchmark data found. Please run a benchmark first, then generate the report.');
      return;
    }

    const bmResult  = lastBM.result || {};
    const bmModels  = bmResult.models      || [];
    const bmClasses = bmResult.class_names || ['Normal', 'IR', 'OR', 'Ball'];

    // ── AI texts ─────────────────────────────────────────────────────────────
    let AI = {};
    try {
      const live = (typeof STATE !== 'undefined') ? STATE.lastBenchmarkAI : null;
      if (live && Object.keys(live).length > 0) AI = live;
      else { const r = localStorage.getItem('bearingfl_benchmark_ai'); if (r) AI = JSON.parse(r); }
    } catch (_) {}

    // ── Training histories ───────────────────────────────────────────────────
    const histories = {};
    await Promise.all(bmModels.map(async m => {
      if (!m.model_id) return;
      try {
        const r = await fetch(`/api/models/${encodeURIComponent(m.model_id)}/metrics`);
        if (r.ok) histories[m.model_id] = await r.json();
      } catch (_) {}
    }));

    // ── Capture chart images ─────────────────────────────────────────────────
    const images = {};
    const chartMap = {
      'chart_acc.png':       'bm-chart-acc',
      'chart_time.png':      'bm-chart-time',
      'chart_radar.png':     'bm-chart-radar',
      'chart_class_acc.png': 'bm-chart-class-acc',
      'chart_f1.png':        'bm-chart-f1',
    };
    for (const [fname, id] of Object.entries(chartMap)) {
      const data = _captureChart(id);
      if (data) images[fname] = data;
    }

    // ── EFS logo ─────────────────────────────────────────────────────────────
    try {
      const resp = await fetch('/static/efs-logo.svg');
      if (resp.ok) {
        let svg = await resp.text();
        svg = svg.replace(/(<svg[^>]*?)(\s+width="[^"]*")?(\s+height="[^"]*")?([^>]*>)/, '$1 width="272" height="214"$4');
        const url  = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        const img  = new Image();
        await new Promise(res => { img.onload = res; img.onerror = res; img.src = url; });
        const cv   = document.createElement('canvas'); cv.width = 272; cv.height = 214;
        const ctx  = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 272, 214);
        try { ctx.drawImage(img, 0, 0, 272, 214); images['logo.png'] = cv.toDataURL('image/png'); } catch (_) {}
      }
    } catch (_) {}

    if (btn) btn.innerHTML = 'Compiling PDF…';

    // ── Build LaTeX ──────────────────────────────────────────────────────────
    const latex = _buildLatex({
      bmResult, bmModels, bmClasses, AI, histories,
      generatedAt: new Date(),
      bmTimestamp: lastBM.timestamp,
      images,
    });

    // ── Send to backend and download ─────────────────────────────────────────
    const resp = await fetch('/api/report/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex_source: latex, images }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Server compilation failed:\n${err.slice(0, 800)}`);
    }

    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `BearingFL_Benchmark_Report_${new Date().toISOString().slice(0,10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 3000);

  } catch (err) {
    console.error('Report error:', err);
    alert('Failed to generate report:\n' + err.message);
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
    if (typeof _updateSessionBadge === 'function') _updateSessionBadge();
  }
}
