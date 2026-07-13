import { getIconSvg } from './icons.js';

function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const BASE_CSS = `
* { margin:0; padding:0; box-sizing:border-box; }
html,body { width:1080px; height:1350px; overflow:hidden;
  font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif; }
.card { position:relative; width:1080px; height:1350px; display:flex; flex-direction:column;
  justify-content:center; padding:90px; color:#fff;
  background:linear-gradient(160deg,#0f2027,#203a43 50%,#2c5364); }
.card.light { background:#ffffff; color:#12202b; }
.bg { position:absolute; inset:0; background-size:cover; background-position:center; opacity:.35; }
.inner { position:relative; z-index:1; }
.brand { position:absolute; top:60px; left:90px; font-size:30px; letter-spacing:2px; opacity:.85; z-index:1; }
.card.light .brand { opacity:.55; }
.page { position:absolute; top:60px; right:90px; font-size:28px; opacity:.7; z-index:1; }
.icon { margin-bottom:36px; }
h1 { font-size:88px; font-weight:800; line-height:1.25; word-break:keep-all; }
h2 { font-size:64px; font-weight:800; line-height:1.3; word-break:keep-all; margin-bottom:40px; }
p  { font-size:44px; line-height:1.6; word-break:keep-all; opacity:.95; }
.data { font-size:120px; font-weight:900; margin:50px 0; }
.outro h2 { font-size:72px; }
.chart-wrap { width:900px; height:640px; margin-top:20px; }
.chart-unit { font-size:32px; opacity:.6; margin-top:16px; }
table.rank-table { width:100%; border-collapse:collapse; margin-top:20px; }
table.rank-table td { padding:22px 10px; font-size:38px; border-bottom:2px solid #12202b1a; }
.rank-badge {
  display:inline-flex; align-items:center; justify-content:center;
  width:56px; height:56px; border-radius:50%; background:#12202b; color:#fff;
  font-weight:800; font-size:30px;
}
.rank-label { font-weight:700; }
.rank-delta.up { color:#d6293e; }
.rank-delta.down { color:#1d6fd6; }
`;

function renderChartInner(card) {
  const hasData = Array.isArray(card.labels) && Array.isArray(card.values)
    && card.labels.length > 0 && card.labels.length === card.values.length;
  if (!hasData) {
    return `<h2>${esc(card.title)}</h2><p>⚠ 차트 데이터가 없습니다. 직접 입력해주세요.</p>`;
  }
  const chartType = card.chartType === 'bar' ? 'bar' : 'line';
  return `<h2>${esc(card.title)}</h2>
    <div class="chart-wrap"><canvas id="chart" width="900" height="640"></canvas></div>
    ${card.unit ? `<div class="chart-unit">단위: ${esc(card.unit)}</div>` : ''}
    <script>
      new Chart(document.getElementById('chart'), {
        type: ${JSON.stringify(chartType)},
        data: {
          labels: ${JSON.stringify(card.labels)},
          datasets: [{
            data: ${JSON.stringify(card.values)},
            borderColor: '#1d6fd6', backgroundColor: '#1d6fd688',
            borderWidth: 4, tension: 0.3, fill: ${chartType === 'line'}
          }]
        },
        options: {
          responsive: false, animation: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { font: { size: 26 }, color: '#12202b' } },
            y: { ticks: { font: { size: 26 }, color: '#12202b' } }
          }
        }
      });
    </script>`;
}

function renderTableInner(card) {
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
  return `<h2>${esc(card.title)}</h2><table class="rank-table"><tbody>${rows}</tbody></table>`;
}

export function renderCardHtml(card, { seq, total, bgDataUri = null, brand = 'ECON LAB', chartLibJs = '' } = {}) {
  const isLight = card.template === 'chart' || card.template === 'table';
  const bg = bgDataUri ? `<div class="bg" style="background-image:url('${bgDataUri}')"></div>` : '';
  const iconHtml = card.icon ? `<div class="icon">${getIconSvg(card.icon, { size: 72, color: isLight ? '#12202b' : '#fff' })}</div>` : '';
  let inner = '';

  if (card.template === 'cover') {
    inner = `<h1>${esc(card.title)}</h1>${card.body ? `<p style="margin-top:50px">${esc(card.body)}</p>` : ''}`;
  } else if (card.template === 'data') {
    inner = `${iconHtml}<h2>${esc(card.title)}</h2><div class="data">${esc(card.dataLabel || '')}</div><p>${esc(card.body)}</p>`;
  } else if (card.template === 'outro') {
    inner = `<div class="outro"><h2>${esc(card.title)}</h2><p>${esc(card.body)}</p></div>`;
  } else if (card.template === 'chart') {
    inner = renderChartInner(card);
  } else if (card.template === 'table') {
    inner = renderTableInner(card);
  } else {
    inner = `${iconHtml}<h2>${esc(card.title)}</h2><p>${esc(card.body)}</p>`;
  }

  const chartScript = (card.template === 'chart' && chartLibJs) ? `<script>${chartLibJs}</script>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style>${chartScript}</head>
<body><div class="card${isLight ? ' light' : ''}">${bg}
  <div class="brand">${esc(brand)}</div>
  <div class="page">${seq} / ${total}</div>
  <div class="inner">${inner}</div>
</div>
<script>window.__ready = true;</script>
</body></html>`;
}
