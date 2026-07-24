import { getIconSvg } from './icons.js';

function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const BASE_CSS = `
* { margin:0; padding:0; box-sizing:border-box; }
html,body { width:1080px; height:1350px; overflow:hidden;
  font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif; }
.card { position:relative; width:1080px; height:1350px; background:#ffffff; color:#14181c;
  padding:64px 64px 56px; display:flex; flex-direction:column; }
.topbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:22px; flex:none; }
.content { flex:1; display:flex; flex-direction:column; justify-content:center; }
.brand-chip { background:#14181c; color:#fff; font-weight:800; font-size:24px; padding:8px 18px;
  border-radius:8px; letter-spacing:1px; }
.page { font-size:24px; color:#8a94a0; font-weight:700; }
.source-line { font-size:20px; color:#8a94a0; margin-bottom:16px; font-weight:600; }
.tag { display:inline-block; font-weight:800; font-size:26px; color:#fff; padding:8px 20px;
  border-radius:6px; margin-bottom:20px; }
.tag.blue { background:#1d6fd6; }
.tag.red { background:#e0243e; }
.meta { font-size:24px; color:#5c6b7a; margin-bottom:14px; font-weight:700; }
.icon { margin-bottom:24px; }
h1 { font-size:74px; font-weight:900; line-height:1.28; word-break:keep-all; letter-spacing:-1px; }
h2 { font-size:50px; font-weight:900; line-height:1.3; word-break:keep-all; margin-bottom:28px; letter-spacing:-.5px;
  padding-left:22px; border-left:10px solid #1d6fd6; }
h2.accent-red { border-left-color:#e0243e; }
p.body { font-size:34px; line-height:1.6; word-break:keep-all; color:#333; margin-top:20px; }
.outro-cta { font-size:34px; color:#5c6b7a; margin-top:20px; font-weight:600; }
.big-stat { font-size:128px; font-weight:900; line-height:1; margin:16px 0 28px; }
.big-stat.red { color:#e0243e; }
.big-stat.blue { color:#1d6fd6; }
.big-stat.black { color:#14181c; }
.mini-rows { display:flex; flex-direction:column; margin-top:8px; }
.mini-row { display:flex; justify-content:space-between; align-items:center; padding:20px 0;
  border-bottom:2px solid #eef0f2; font-size:32px; }
.mini-row .label { font-weight:700; color:#333; }
.mini-row .value { font-weight:900; }
.bullets { display:flex; flex-direction:column; gap:18px; margin-top:12px; }
.bullet-item { display:flex; gap:14px; font-size:32px; line-height:1.5; font-weight:700; word-break:keep-all; }
.bullet-icon { color:#1d6fd6; font-weight:900; flex-shrink:0; }
.table-card { border:1px solid #e7eaee; border-radius:18px; overflow:hidden; margin-top:18px;
  box-shadow:0 6px 20px rgba(20,24,28,.06); }
.grid-table { width:100%; border-collapse:collapse; table-layout:fixed; }
.grid-table th { background:#14203f; color:#fff; font-size:24px; font-weight:800; padding:22px 14px;
  text-align:center; word-break:keep-all; letter-spacing:.5px; }
.grid-table th:first-child { text-align:left; padding-left:30px; }
.grid-table td { font-size:30px; font-weight:700; padding:22px 14px; text-align:center;
  border-bottom:1px solid #eef0f2; word-break:keep-all; color:#232830; }
.grid-table td:first-child { text-align:left; padding-left:30px; font-weight:800; }
.grid-table tr:last-child td { border-bottom:none; }
.grid-table tr:nth-child(even) td { background:#f6f8fb; }
.grid-table .cell-neg { color:#e0243e; }
.grid-table .cell-pos { color:#1d6fd6; }
table.rank-table { width:100%; border-collapse:collapse; }
table.rank-table td { padding:22px 16px; font-size:32px; border-bottom:1px solid #eef0f2; }
table.rank-table tr:last-child td { border-bottom:none; }
table.rank-table tr:nth-child(even) td { background:#f6f8fb; }
.rank-badge { display:inline-flex; align-items:center; justify-content:center; width:52px; height:52px;
  border-radius:50%; background:#14203f; color:#fff; font-weight:800; font-size:26px; }
.rank-label { font-weight:800; }
.rank-delta.up { color:#e0243e; font-weight:800; }
.rank-delta.down { color:#1d6fd6; font-weight:800; }
.chart-card { border:1px solid #e7eaee; border-radius:18px; padding:28px 24px 18px; margin-top:18px;
  box-shadow:0 6px 20px rgba(20,24,28,.06); }
.chart-wrap { width:900px; height:480px; }
.chart-unit { font-size:24px; color:#8a94a0; margin-top:8px; font-weight:700; text-align:right; }
`;

function tagHtml(tag) {
  if (!tag || !tag.text) return '';
  return `<div class="tag ${tag.color === 'red' ? 'red' : 'blue'}">${esc(tag.text)}</div>`;
}

function renderChartInner(card) {
  const hasData = Array.isArray(card.labels) && Array.isArray(card.values)
    && card.labels.length > 0 && card.labels.length === card.values.length;
  if (!hasData) {
    return `<h2>${esc(card.title)}</h2><p class="body">⚠ 차트 데이터가 없습니다. 직접 입력해주세요.</p>`;
  }
  const chartType = card.chartType === 'bar' ? 'bar' : 'line';
  const accentClass = card.tag?.color === 'red' ? ' accent-red' : '';
  return `<h2 class="${accentClass.trim()}">${esc(card.title)}</h2>
    <div class="chart-card">
      <div class="chart-wrap"><canvas id="chart" width="900" height="480"></canvas></div>
      ${card.unit ? `<div class="chart-unit">단위: ${esc(card.unit)}</div>` : ''}
    </div>
    <script>
      (function() {
        var canvas = document.getElementById('chart');
        var ctx2d = canvas.getContext('2d');
        var gradient = ctx2d.createLinearGradient(0, 0, 0, 480);
        gradient.addColorStop(0, 'rgba(29,111,214,.32)');
        gradient.addColorStop(1, 'rgba(29,111,214,.02)');
        var n = ${card.values.length};
        var dense = n > 5;
        var fontPx = dense ? 22 : 26;
        var valueLabelPlugin = {
          id: 'valueLabels',
          afterDatasetsDraw: function (chart) {
            var c = chart.ctx;
            c.save();
            c.font = '800 ' + fontPx + 'px "Malgun Gothic"';
            c.fillStyle = '#14181c';
            chart.data.datasets.forEach(function (ds, di) {
              var meta = chart.getDatasetMeta(di);
              var count = meta.data.length;
              meta.data.forEach(function (el, i) {
                var v = ds.data[i];
                var label = typeof v === 'number' ? v.toLocaleString('ko-KR') : v;
                var prev = i > 0 ? ds.data[i - 1] : null;
                var next = i < count - 1 ? ds.data[i + 1] : null;
                var isPeak = (prev === null || v >= prev) && (next === null || v >= next);
                c.textAlign = i === 0 ? 'left' : (i === count - 1 ? 'right' : 'center');
                var x = el.x + (i === 0 ? 6 : (i === count - 1 ? -6 : 0));
                var y = isPeak ? el.y - 14 : el.y + (fontPx + 12);
                c.fillText(label, x, y);
              });
            });
            c.restore();
          }
        };
        new Chart(canvas, {
          type: ${JSON.stringify(chartType)},
          data: {
            labels: ${JSON.stringify(card.labels).replace(/</g, '\\u003c')},
            datasets: [{
              data: ${JSON.stringify(card.values).replace(/</g, '\\u003c')},
              borderColor: '#1d6fd6',
              backgroundColor: ${chartType === 'bar' ? "'#1d6fd6'" : 'gradient'},
              borderWidth: 4,
              tension: .35,
              fill: ${chartType === 'line'},
              pointRadius: dense ? 5 : 8,
              pointHoverRadius: dense ? 5 : 8,
              pointBackgroundColor: '#fff',
              pointBorderColor: '#1d6fd6',
              pointBorderWidth: dense ? 3 : 4,
              borderRadius: ${chartType === 'bar' ? 12 : 0},
              maxBarThickness: 130
            }]
          },
          options: {
            responsive: false, animation: false,
            layout: { padding: { top: 44, right: 28, left: 28, bottom: 40 } },
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: dense ? 20 : 26, weight: '700' }, color: '#14181c' } },
              y: { grace: '22%', grid: { color: '#eef0f2' }, border: { display: false }, ticks: { display: false } }
            }
          },
          plugins: [valueLabelPlugin]
        });
      })();
    </script>`;
}

function cellClass(cell) {
  const s = String(cell).trim();
  if (/^[-−]/.test(s)) return ' class="cell-neg"';
  if (/^\+/.test(s)) return ' class="cell-pos"';
  return '';
}

function renderTableInner(card) {
  const accentClass = card.tag?.color === 'red' ? ' accent-red' : '';
  const heading = `<h2 class="${accentClass.trim()}">${esc(card.title)}</h2>`;
  const hasColumns = Array.isArray(card.columns) && card.columns.length > 0;
  if (hasColumns) {
    const thead = `<tr>${card.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`;
    const tbody = (card.rows || []).map(row =>
      `<tr>${row.map(cell => `<td${cellClass(cell)}>${esc(String(cell))}</td>`).join('')}</tr>`
    ).join('');
    return `${heading}<div class="table-card"><table class="grid-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
  }
  const rows = (card.rows || []).map((r, i) => {
    const deltaStr = String(r.delta ?? '');
    const dir = deltaStr.trim().startsWith('-') ? 'down' : 'up';
    return `
      <tr>
        <td><span class="rank-badge">${esc(String(r.rank ?? i + 1))}</span></td>
        <td class="rank-label">${esc(r.label || '')}</td>
        <td>${esc(String(r.value ?? ''))}</td>
        <td class="rank-delta ${dir}">${esc(deltaStr)}</td>
      </tr>`;
  }).join('');
  return `${heading}<div class="table-card"><table class="rank-table"><tbody>${rows}</tbody></table></div>`;
}

export function renderCardHtml(card, { seq, total, brand = 'ECON LAB', chartLibJs = '' } = {}) {
  const tag = tagHtml(card.tag);
  const source = card.source ? `<div class="source-line">${esc(card.source)}</div>` : '';
  const meta = card.meta ? `<div class="meta">${esc(card.meta)}</div>` : '';
  const iconHtml = card.icon ? `<div class="icon">${getIconSvg(card.icon, { size: 64, color: '#14181c' })}</div>` : '';
  let inner = '';

  if (card.template === 'cover') {
    inner = `${tag}${meta}<h1>${esc(card.title)}</h1>${card.body ? `<p class="body">${esc(card.body)}</p>` : ''}`;
  } else if (card.template === 'data') {
    const rowsHtml = (card.rows || []).map(r =>
      `<div class="mini-row"><span class="label">${esc(r.label)}</span><span class="value">${esc(String(r.value))}</span></div>`
    ).join('');
    inner = `${tag}${iconHtml}<h2>${esc(card.title)}</h2>
      <div class="big-stat ${['red', 'blue'].includes(card.dataColor) ? card.dataColor : 'black'}">${esc(card.dataLabel || '')}</div>
      ${card.body ? `<p class="body">${esc(card.body)}</p>` : ''}
      ${rowsHtml ? `<div class="mini-rows">${rowsHtml}</div>` : ''}`;
  } else if (card.template === 'outro') {
    inner = `${tag}<h2>${esc(card.title)}</h2>${card.body ? `<p class="outro-cta">${esc(card.body)}</p>` : ''}`;
  } else if (card.template === 'chart') {
    inner = `${tag}${renderChartInner(card)}`;
  } else if (card.template === 'table') {
    inner = `${tag}${renderTableInner(card)}`;
  } else if (card.template === 'subscription') {
    const rows = [
      { label: '청약접수', value: `${card.receiptStart || ''} ~ ${card.receiptEnd || ''}` },
      { label: '당첨자발표', value: card.winnerDate || '' },
    ].map(r => `<div class="mini-row"><span class="label">${esc(r.label)}</span><span class="value">${esc(r.value)}</span></div>`).join('');
    inner = `${tag}<h2>${esc(card.title)}</h2>
      ${card.region ? `<div class="meta">${esc(card.region)}</div>` : ''}
      <div class="big-stat black">${esc(card.totalSupply || '')}</div>
      <div class="mini-rows">${rows}</div>`;
  } else {
    const bullets = (card.bullets || []).map(b =>
      `<div class="bullet-item"><span class="bullet-icon">★</span><span>${esc(b)}</span></div>`
    ).join('');
    inner = `${tag}${iconHtml}<h2>${esc(card.title)}</h2>
      ${bullets ? `<div class="bullets">${bullets}</div>` : (card.body ? `<p class="body">${esc(card.body)}</p>` : '')}`;
  }

  const chartScript = (card.template === 'chart' && chartLibJs) ? `<script>${chartLibJs}</script>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style>${chartScript}</head>
<body><div class="card">
  <div class="topbar"><div class="brand-chip">${esc(brand)}</div><div class="page">${seq} / ${total}</div></div>
  <div class="content">
    ${source}
    <div class="inner">${inner}</div>
  </div>
</div>
<script>window.__ready = true;</script>
</body></html>`;
}
