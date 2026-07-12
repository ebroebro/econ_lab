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
.bg { position:absolute; inset:0; background-size:cover; background-position:center; opacity:.35; }
.inner { position:relative; z-index:1; }
.brand { position:absolute; top:60px; left:90px; font-size:30px; letter-spacing:2px; opacity:.85; z-index:1; }
.page { position:absolute; top:60px; right:90px; font-size:28px; opacity:.7; z-index:1; }
h1 { font-size:88px; font-weight:800; line-height:1.25; word-break:keep-all; }
h2 { font-size:64px; font-weight:800; line-height:1.3; word-break:keep-all; margin-bottom:40px; }
p  { font-size:44px; line-height:1.6; word-break:keep-all; opacity:.95; }
.data { font-size:120px; font-weight:900; margin:50px 0; }
.outro h2 { font-size:72px; }
`;

export function renderCardHtml(card, { seq, total, bgDataUri = null, brand = 'ECON LAB' } = {}) {
  const bg = bgDataUri ? `<div class="bg" style="background-image:url('${bgDataUri}')"></div>` : '';
  let inner = '';
  if (card.template === 'cover') {
    inner = `<h1>${esc(card.title)}</h1>${card.body ? `<p style="margin-top:50px">${esc(card.body)}</p>` : ''}`;
  } else if (card.template === 'data') {
    inner = `<h2>${esc(card.title)}</h2><div class="data">${esc(card.dataLabel || '')}</div><p>${esc(card.body)}</p>`;
  } else if (card.template === 'outro') {
    inner = `<div class="outro"><h2>${esc(card.title)}</h2><p>${esc(card.body)}</p></div>`;
  } else {
    inner = `<h2>${esc(card.title)}</h2><p>${esc(card.body)}</p>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head>
<body><div class="card">${bg}
  <div class="brand">${esc(brand)}</div>
  <div class="page">${seq} / ${total}</div>
  <div class="inner">${inner}</div>
</div></body></html>`;
}
