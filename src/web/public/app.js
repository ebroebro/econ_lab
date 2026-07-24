const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let selectedSources = new Set();
let currentDraft = null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// 파일 업로드용 — content-type을 직접 지정하지 않고 브라우저가 boundary를 붙이게 둔다.
async function apiForm(path, formData) {
  const res = await fetch(path, { method: 'POST', body: formData });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = isError ? 'error' : '';
  t.hidden = false;
  setTimeout(() => { t.hidden = true; }, 4000);
}

function busy(btn, on, label) {
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = `⏳ ${label}`; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label; btn.disabled = false; }
}

// ---------- 탭 ----------
$$('.tab').forEach(btn => btn.addEventListener('click', () => {
  $$('.tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  $$('.panel').forEach(p => p.hidden = true);
  $(`#tab-${btn.dataset.tab}`).hidden = false;
  if (btn.dataset.tab === 'sources') loadSources();
  if (btn.dataset.tab === 'drafts') { $('#draft-detail').hidden = true; $('#draft-list').hidden = false; loadDrafts(); }
  if (btn.dataset.tab === 'posts') loadPosts();
}));

// ---------- 소스함 ----------
const TYPE_LABEL = { news: '뉴스', realestate: '부동산', stock: '증시', subscription: '청약', manual: '직접 입력' };

// 소스 제목+요약을 우선순위 순서로 키워드 매칭해 세분화된 주제로 묶는다. DB/서버 변경 없이
// 화면에서만 그룹핑한다 — 더 구체적인 카테고리(청약)를 일반적인 카테고리(부동산정책)보다 먼저 검사.
const TOPIC_RULES = [
  { key: 'subscription', label: '청약', patterns: [/청약/, /분양/, /입주자모집/, /특별공급/, /당첨/] },
  { key: 'realestate_policy', label: '부동산정책', patterns: [/규제/, /DSR/, /대출/, /재건축/, /재개발/, /종부세/, /재산세/, /공급대책/, /토론회/] },
  { key: 'us_stock', label: '미국주식', patterns: [/미국/, /나스닥/, /다우/, /S&P/, /연준/, /Fed/, /파월/, /ADR/, /월가/] },
  { key: 'kr_stock', label: '국내주식', patterns: [/코스피/, /코스닥/, /삼성전자/, /하이닉스/, /특징주/, /상한가/, /실적/, /증권/] },
  { key: 'rate_fx', label: '금리·환율', patterns: [/기준금리/, /환율/, /원\/달러/, /한은/, /금통위/] },
  { key: 'etc', label: '기타', patterns: [] },
];

function classifySource(source) {
  const text = `${source.title || ''} ${source.summary || ''}`;
  for (const rule of TOPIC_RULES) {
    if (rule.patterns.length === 0) return rule.key; // 마지막 규칙(기타)은 항상 매치되는 폴백
    if (rule.patterns.some((re) => re.test(text))) return rule.key;
  }
  return 'etc';
}

function buildSourceCard(s, recommended) {
  const card = document.createElement('div');
  card.className = 'src-card' + (selectedSources.has(s.id) ? ' selected' : '');
  card.innerHTML = `
    <div class="src-head">
      <span class="badge ${s.type}">${TYPE_LABEL[s.type] || s.type}</span>
      ${recommended ? '<span class="badge recommend">⭐ 오늘의 추천</span>' : ''}
      <span class="src-meta">${s.collected_at || ''}</span>
    </div>
    <div class="src-title"></div>
    <div class="src-summary"></div>`;
  card.querySelector('.src-title').textContent = s.title;
  card.querySelector('.src-summary').textContent = s.summary || '';
  card.addEventListener('click', () => {
    if (selectedSources.has(s.id)) selectedSources.delete(s.id);
    else selectedSources.add(s.id);
    card.classList.toggle('selected');
    $('#btn-goto-builder').disabled = selectedSources.size === 0;
    $('#btn-story-mode').disabled = selectedSources.size === 0;
  });
  return card;
}

async function loadSources() {
  const type = $('#src-type-filter').value;
  const sources = await api(`/api/sources?status=new${type ? `&type=${type}` : ''}`);
  const list = $('#source-list');
  list.innerHTML = '';
  if (!sources.length) {
    list.innerHTML = '<p style="color:#5c6b7a">소스가 없습니다. [지금 수집]을 누르거나 주제를 직접 입력하세요.</p>';
    return;
  }

  // 서버가 이미 collected_at DESC로 정렬해 보내므로, 그룹핑 후에도 카테고리 안의 순서는
  // 최신순을 유지한다 — 그래서 각 그룹의 앞쪽 2개가 곧 "최신 2개"다.
  const groups = new Map(TOPIC_RULES.map((r) => [r.key, []]));
  for (const s of sources) groups.get(classifySource(s)).push(s);

  for (const rule of TOPIC_RULES) {
    const items = groups.get(rule.key);
    if (!items.length) continue;
    const section = document.createElement('div');
    section.className = 'source-group';
    section.innerHTML = `<h3 class="source-group-title">${rule.label}</h3>`;
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    items.forEach((s, i) => grid.appendChild(buildSourceCard(s, i < 2)));
    section.appendChild(grid);
    list.appendChild(section);
  }
}

$('#src-type-filter').addEventListener('change', loadSources);

$('#btn-collect').addEventListener('click', async (e) => {
  busy(e.target, true, '수집 중…');
  try {
    const r = await api('/api/collect', { method: 'POST' });
    toast(`수집 완료 — 뉴스 ${r.news} · 증시 ${r.stocks} · 부동산 ${r.realestate}`);
    await loadSources();
  } catch (err) { toast(err.message, true); }
  finally { busy(e.target, false); }
});

$('#btn-add-manual').addEventListener('click', async () => {
  const title = $('#manual-title').value.trim();
  if (!title) return toast('주제를 입력하세요', true);
  try {
    await api('/api/sources', { method: 'POST', body: { title, summary: $('#manual-summary').value.trim() } });
    $('#manual-title').value = ''; $('#manual-summary').value = '';
    toast('주제가 추가되었습니다');
    await loadSources();
  } catch (err) { toast(err.message, true); }
});

$('#btn-add-manual-images').addEventListener('click', async (e) => {
  const files = $('#manual-images').files;
  if (!files.length) return toast('이미지를 1장 이상 선택하세요', true);
  busy(e.target, true, '업로드 중…');
  try {
    const fd = new FormData();
    for (const f of files) fd.append('images', f);
    fd.append('caption', $('#manual-images-caption').value.trim());
    fd.append('threadsText', $('#manual-images-threads').value.trim());
    const draft = await apiForm('/api/drafts/manual', fd);
    $('#manual-images').value = ''; $('#manual-images-caption').value = ''; $('#manual-images-threads').value = '';
    toast(`카드뉴스가 생성되었습니다 (${draft.content.cards.length}장)`);
    goToDraft(draft);
  } catch (err) { toast(err.message, true); }
  finally { busy(e.target, false); }
});

const TEMPLATE_LABEL = { cover: '표지', text: '설명', data: '수치 강조', chart: '차트', table: '순위표', outro: '마무리', subscription: '청약정보', manual: '직접 업로드' };
let slots = [];

function renderSlots() {
  const wrap = $('#slot-list');
  wrap.innerHTML = '';
  slots.forEach((type, i) => {
    const row = document.createElement('div');
    row.className = 'slot-row';
    row.innerHTML = `
      <span class="src-meta">카드 ${i + 1}</span>
      <select data-i="${i}">
        ${Object.entries(TEMPLATE_LABEL).map(([v, label]) => `<option value="${v}"${v === type ? ' selected' : ''}>${label}</option>`).join('')}
      </select>
      <button type="button" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" data-act="down" data-i="${i}" ${i === slots.length - 1 ? 'disabled' : ''}>↓</button>
      <button type="button" data-act="remove" data-i="${i}" ${slots.length <= 1 ? 'disabled' : ''}>삭제</button>`;
    wrap.appendChild(row);
  });
}

$('#slot-list').addEventListener('change', (e) => {
  if (e.target.tagName !== 'SELECT') return;
  slots[Number(e.target.dataset.i)] = e.target.value;
});

$('#slot-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const i = Number(btn.dataset.i);
  if (btn.dataset.act === 'remove' && slots.length > 1) slots.splice(i, 1);
  if (btn.dataset.act === 'up' && i > 0) [slots[i - 1], slots[i]] = [slots[i], slots[i - 1]];
  if (btn.dataset.act === 'down' && i < slots.length - 1) [slots[i + 1], slots[i]] = [slots[i], slots[i + 1]];
  renderSlots();
});

$('#btn-add-slot').addEventListener('click', () => { slots.push('text'); renderSlots(); });

$('#btn-goto-builder').addEventListener('click', () => {
  if (!slots.length) slots = ['cover', 'text', 'text', 'outro'];
  $('#builder-info').textContent = `카드 구성 (소스 ${selectedSources.size}개 선택됨)`;
  renderSlots();
  $('#card-builder').hidden = false;
});

$('#btn-builder-back').addEventListener('click', () => {
  $('#card-builder').hidden = true;
});

function goToDraft(draft) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'drafts'));
  $$('.panel').forEach(p => p.hidden = true);
  $('#tab-drafts').hidden = false;
  openDraft(draft.id);
}

$('#btn-generate-draft').addEventListener('click', async (e) => {
  busy(e.target, true, 'Gemini 글 생성 중…');
  try {
    const draft = await api('/api/drafts', { method: 'POST', body: { sourceIds: [...selectedSources], cardTypes: slots } });
    selectedSources.clear();
    slots = [];
    $('#card-builder').hidden = true;
    toast('초안이 생성되었습니다');
    goToDraft(draft);
  } catch (err) { toast(err.message, true); }
  finally { busy(e.target, false); }
});

$('#btn-story-mode').addEventListener('click', async (e) => {
  busy(e.target, true, 'Gemini 스토리 분석 중…');
  try {
    const draft = await api('/api/drafts', { method: 'POST', body: { sourceIds: [...selectedSources], storyMode: true } });
    selectedSources.clear();
    toast(`스토리 초안이 생성되었습니다 (${draft.content.cards.length}장)`);
    goToDraft(draft);
  } catch (err) { toast(err.message, true); }
  finally { busy(e.target, false); }
});

// ---------- 초안 ----------
const ST_LABEL = { draft: '글 검수 중', text_approved: '글 확정됨', images_ready: '이미지 준비됨', published: '발행 완료' };

async function loadDrafts() {
  const drafts = await api('/api/drafts');
  const list = $('#draft-list');
  list.innerHTML = '';
  if (!drafts.length) {
    list.innerHTML = '<p style="color:#5c6b7a">초안이 없습니다. 소스함에서 콘텐츠를 만들어보세요.</p>';
    return;
  }
  for (const d of drafts) {
    const card = document.createElement('div');
    card.className = 'draft-card';
    card.innerHTML = `
      <div class="src-head">
        <span class="badge st-${d.status}">${ST_LABEL[d.status] || d.status}</span>
        <span class="src-meta">#${d.id} · ${d.updated_at}</span>
      </div>
      <div class="src-title"></div>`;
    card.querySelector('.src-title').textContent = d.content?.cards?.[0]?.title || '(제목 없음)';
    card.addEventListener('click', () => openDraft(d.id));
    list.appendChild(card);
  }
}

async function openDraft(id) {
  currentDraft = await api(`/api/drafts/${id}`);
  $('#draft-list').hidden = true;
  $('#draft-detail').hidden = false;
  renderDraftDetail();
  await renderCardPreview();
}

const ICON_OPTIONS = ['', 'building', 'percent', 'trend-up', 'trend-down', 'coin', 'calendar', 'alert', 'chart'];

function iconSelectHtml(value) {
  return `<select data-f="icon">${ICON_OPTIONS.map(v =>
    `<option value="${v}"${v === (value || '') ? ' selected' : ''}>${v || '(아이콘 없음)'}</option>`
  ).join('')}</select>`;
}

function renderChartRows(ed, c) {
  const wrap = ed.querySelector('.chart-rows');
  const labels = c.labels || [];
  const values = c.values || [];
  wrap.innerHTML = '';
  const len = Math.max(labels.length, values.length, 1);
  for (let r = 0; r < len; r++) {
    const row = document.createElement('div');
    row.className = 'row-pair';
    row.innerHTML = `
      <input placeholder="라벨" data-row="${r}" data-part="label">
      <input placeholder="값" type="number" data-row="${r}" data-part="value">
      <button type="button" class="row-remove" data-row="${r}">✕</button>`;
    row.querySelector('[data-part="label"]').value = labels[r] || '';
    row.querySelector('[data-part="value"]').value = values[r] ?? '';
    wrap.appendChild(row);
  }
}

function renderTableRows(ed, c) {
  const wrap = ed.querySelector('.table-rows');
  const rows = c.rows || [];
  wrap.innerHTML = '';
  rows.forEach((r, idx) => {
    const row = document.createElement('div');
    row.className = 'row-triple';
    row.innerHTML = `
      <input placeholder="순위" type="number" data-row="${idx}" data-part="rank">
      <input placeholder="이름" data-row="${idx}" data-part="label">
      <input placeholder="값" data-row="${idx}" data-part="value">
      <input placeholder="증감 (+2, -1)" data-row="${idx}" data-part="delta">
      <button type="button" class="row-remove" data-row="${idx}">✕</button>`;
    row.querySelector('[data-part="rank"]').value = r.rank ?? idx + 1;
    row.querySelector('[data-part="label"]').value = r.label || '';
    row.querySelector('[data-part="value"]').value = r.value ?? '';
    row.querySelector('[data-part="delta"]').value = r.delta || '';
    wrap.appendChild(row);
  });
}

function buildCardEditor(c, i) {
  const ed = document.createElement('div');
  ed.className = 'card-editor';
  ed.dataset.i = i;

  if (c.template === 'chart') {
    ed.innerHTML = `
      <label>카드 ${i + 1} · ${TEMPLATE_LABEL[c.template]}</label>
      <input data-f="title" placeholder="제목">
      <div class="chart-rows"></div>
      <button type="button" class="row-add" data-kind="chart">+ 항목 추가</button>
      <select data-f="chartType"><option value="line">선 그래프</option><option value="bar">막대 그래프</option></select>
      <input data-f="unit" placeholder="단위 (예: %)">`;
    ed.querySelector('[data-f="title"]').value = c.title || '';
    ed.querySelector('[data-f="chartType"]').value = c.chartType || 'line';
    ed.querySelector('[data-f="unit"]').value = c.unit || '';
    renderChartRows(ed, c);
  } else if (c.template === 'table') {
    ed.innerHTML = `
      <label>카드 ${i + 1} · ${TEMPLATE_LABEL[c.template]}</label>
      <input data-f="title" placeholder="제목">
      <div class="table-rows"></div>
      <button type="button" class="row-add" data-kind="table">+ 행 추가</button>`;
    ed.querySelector('[data-f="title"]').value = c.title || '';
    renderTableRows(ed, c);
  } else if (c.template === 'subscription') {
    ed.innerHTML = `
      <label>카드 ${i + 1} · ${TEMPLATE_LABEL[c.template]}</label>
      <input data-f="title" placeholder="단지명">
      <input data-f="region" placeholder="공급지역 (예: 서울 강남구)">
      <input data-f="totalSupply" placeholder="총공급세대수 (예: 128세대)">
      <input data-f="receiptStart" placeholder="청약접수 시작일">
      <input data-f="receiptEnd" placeholder="청약접수 종료일">
      <input data-f="winnerDate" placeholder="당첨자 발표일">`;
    ed.querySelector('[data-f="title"]').value = c.title || '';
    ed.querySelector('[data-f="region"]').value = c.region || '';
    ed.querySelector('[data-f="totalSupply"]').value = c.totalSupply || '';
    ed.querySelector('[data-f="receiptStart"]').value = c.receiptStart || '';
    ed.querySelector('[data-f="receiptEnd"]').value = c.receiptEnd || '';
    ed.querySelector('[data-f="winnerDate"]').value = c.winnerDate || '';
  } else {
    ed.innerHTML = `
      <label>카드 ${i + 1} · ${TEMPLATE_LABEL[c.template] || c.template}</label>
      <input data-f="title" placeholder="제목">
      <textarea data-f="body" rows="2" placeholder="본문"></textarea>
      ${c.template === 'data' ? `<input data-f="dataLabel" placeholder="수치 (예: 2.5%)">` : ''}
      ${(c.template === 'text' || c.template === 'data') ? iconSelectHtml(c.icon) : ''}`;
    ed.querySelector('[data-f="title"]').value = c.title || '';
    ed.querySelector('[data-f="body"]').value = c.body || '';
    const dl = ed.querySelector('[data-f="dataLabel"]');
    if (dl) dl.value = c.dataLabel || '';
  }

  ed.querySelectorAll('[data-f]').forEach(el => {
    el.addEventListener('input', () => { currentDraft.content.cards[i][el.dataset.f] = el.value; });
  });

  return ed;
}

function renderDraftDetail() {
  const d = currentDraft;
  const isManual = !!d.content?.manual;
  $('#draft-status').innerHTML = `<span class="badge st-${d.status}">${ST_LABEL[d.status] || d.status}</span> <span class="src-meta">초안 #${d.id}${isManual ? ' · 직접 업로드' : ''}</span>`;
  const wrap = $('#card-editors');
  wrap.innerHTML = '';
  (d.content?.cards || []).forEach((c, i) => wrap.appendChild(buildCardEditor(c, i)));
  $('#ed-caption').value = d.content?.caption || '';
  const threadsPosts = d.content?.threadsPosts?.length ? d.content.threadsPosts : (d.content?.threadsText ? [d.content.threadsText] : []);
  ['#ed-thread-1', '#ed-thread-2', '#ed-thread-3', '#ed-thread-4'].forEach((sel, i) => { $(sel).value = threadsPosts[i] || ''; });
  $('#ed-blog-title').value = d.content?.blogTitle || '';
  $('#ed-blog-body').value = d.content?.blogBody || '';
  $('#btn-publish').disabled = d.status !== 'images_ready';
  $('#publish-result').innerHTML = '';
  $('#naver-result').innerHTML = '';
  $('#tistory-result').innerHTML = '';
  // 직접 업로드한 초안은 글/이미지를 AI로 재생성하면 업로드한 이미지를 덮어써버리므로 막는다.
  $('#btn-regen').hidden = isManual;
  $('#btn-approve').hidden = isManual;
  $('#btn-images').hidden = isManual;
}

$('#card-editors').addEventListener('click', (e) => {
  const addBtn = e.target.closest('.row-add');
  const rmBtn = e.target.closest('.row-remove');
  if (!addBtn && !rmBtn) return;
  const ed = e.target.closest('.card-editor');
  const i = Number(ed.dataset.i);
  const c = currentDraft.content.cards[i];

  if (addBtn) {
    if (addBtn.dataset.kind === 'chart') {
      c.labels = c.labels || []; c.values = c.values || [];
      c.labels.push(''); c.values.push(0);
      renderChartRows(ed, c);
    } else {
      c.rows = c.rows || [];
      c.rows.push({ rank: c.rows.length + 1, label: '', value: '', delta: '' });
      renderTableRows(ed, c);
    }
  } else if (rmBtn) {
    const r = Number(rmBtn.dataset.row);
    if (c.template === 'chart') { c.labels.splice(r, 1); c.values.splice(r, 1); renderChartRows(ed, c); }
    else { c.rows.splice(r, 1); renderTableRows(ed, c); }
  }
});

$('#card-editors').addEventListener('input', (e) => {
  const part = e.target.dataset.part;
  if (!part) return;
  const ed = e.target.closest('.card-editor');
  const i = Number(ed.dataset.i);
  const r = Number(e.target.dataset.row);
  const c = currentDraft.content.cards[i];
  if (c.template === 'chart') {
    if (part === 'label') c.labels[r] = e.target.value;
    if (part === 'value') c.values[r] = Number(e.target.value);
  } else if (c.template === 'table') {
    c.rows[r] = { ...c.rows[r], [part]: part === 'rank' ? Number(e.target.value) : e.target.value };
  }
});

function collectEditedContent() {
  return {
    ...currentDraft.content,
    caption: $('#ed-caption').value,
    threadsPosts: ['#ed-thread-1', '#ed-thread-2', '#ed-thread-3', '#ed-thread-4'].map((sel) => $(sel).value.trim()).filter(Boolean),
    blogTitle: $('#ed-blog-title').value,
    blogBody: $('#ed-blog-body').value,
  };
}

$('#btn-back').addEventListener('click', () => {
  $('#draft-detail').hidden = true;
  $('#draft-list').hidden = false;
  loadDrafts();
});

$('#btn-save').addEventListener('click', async (e) => {
  busy(e.target, true, '저장 중…');
  try {
    currentDraft = await api(`/api/drafts/${currentDraft.id}/content`, { method: 'PUT', body: { content: collectEditedContent() } });
    toast('저장되었습니다');
  } catch (err) { toast(err.message, true); }
  finally { busy(e.target, false); }
});

$('#btn-regen').addEventListener('click', async (e) => {
  busy(e.target, true, 'Gemini 재생성 중…');
  try {
    currentDraft = await api(`/api/drafts/${currentDraft.id}/regenerate`, { method: 'POST' });
    renderDraftDetail();
    toast('글이 재생성되었습니다');
  } catch (err) { toast(err.message, true); }
  finally { busy(e.target, false); }
});

$('#btn-approve').addEventListener('click', async (e) => {
  busy(e.target, true, '저장 중…');
  try {
    await api(`/api/drafts/${currentDraft.id}/content`, { method: 'PUT', body: { content: collectEditedContent() } });
    currentDraft = await api(`/api/drafts/${currentDraft.id}/approve-text`, { method: 'POST' });
    renderDraftDetail();
    toast('글이 확정되었습니다. 이제 이미지를 생성하세요.');
  } catch (err) { toast(err.message, true); }
  finally { busy(e.target, false); }
});

$('#btn-images').addEventListener('click', async (e) => {
  busy(e.target, true, '배경 생성 + 렌더링 중… (1~2분)');
  try {
    await api(`/api/drafts/${currentDraft.id}/images`, { method: 'POST' });
    currentDraft = await api(`/api/drafts/${currentDraft.id}`);
    renderDraftDetail();
    await renderCardPreview();
    toast('카드 이미지가 생성되었습니다');
  } catch (err) { toast(err.message, true); }
  finally { busy(e.target, false); }
});

async function renderCardPreview() {
  const cards = await api(`/api/drafts/${currentDraft.id}/cards`);
  const prev = $('#card-preview');
  prev.innerHTML = cards.length ? '' : '<p style="color:#5c6b7a">아직 생성된 이미지가 없습니다.</p>';
  for (const c of cards) {
    const cell = document.createElement('div');
    cell.className = 'carousel-cell';
    cell.innerHTML = `
      <img src="/images/${currentDraft.id}/card-${c.seq}.png?t=${Date.now()}">
      <label class="replace-label">
        이미지 교체
        <input type="file" accept="image/*" data-seq="${c.seq}" hidden>
      </label>`;
    prev.appendChild(cell);
  }
}

$('#card-preview').addEventListener('change', async (e) => {
  const input = e.target.closest('input[type="file"][data-seq]');
  if (!input || !input.files[0]) return;
  const seq = input.dataset.seq;
  try {
    const fd = new FormData();
    fd.append('image', input.files[0]);
    await apiForm(`/api/drafts/${currentDraft.id}/cards/${seq}/image`, fd);
    currentDraft = await api(`/api/drafts/${currentDraft.id}`);
    renderDraftDetail();
    await renderCardPreview();
    toast(`카드 ${seq} 이미지가 교체되었습니다`);
  } catch (err) { toast(err.message, true); }
});

$('#btn-publish').addEventListener('click', async (e) => {
  if (!confirm('Instagram과 Threads에 실제로 게시합니다. 진행할까요?')) return;
  busy(e.target, true, '배포 중…');
  const out = $('#publish-result');
  try {
    const r = await api(`/api/drafts/${currentDraft.id}/publish`, { method: 'POST' });
    out.innerHTML = [
      r.instagram?.permalink
        ? `✅ Instagram: <a href="${r.instagram.permalink}" target="_blank">${r.instagram.permalink}</a>`
        : `❌ Instagram 실패: ${r.instagram?.error || '알 수 없음'}`,
      r.threads?.permalink
        ? `✅ Threads: <a href="${r.threads.permalink}" target="_blank">${r.threads.permalink}</a>`
        : `❌ Threads 실패: ${r.threads?.error || '알 수 없음'}`,
    ].join('<br>');
    currentDraft = await api(`/api/drafts/${currentDraft.id}`);
    renderDraftDetail();
    toast('배포 처리 완료');
  } catch (err) {
    out.textContent = `배포 실패: ${err.message}`;
    toast(err.message, true);
  }
  finally { busy(e.target, false); }
});

$('#btn-gen-blog').addEventListener('click', async (e) => {
  busy(e.target, true, 'Gemini 블로그 본문 생성 중…');
  try {
    currentDraft = await api(`/api/drafts/${currentDraft.id}/blog`, { method: 'POST' });
    renderDraftDetail();
    await renderCardPreview();
    toast('블로그 본문이 생성되었습니다. 검토 후 임시저장하세요.');
  } catch (err) { toast(err.message, true); }
  finally { busy(e.target, false); }
});

$('#btn-publish-naver').addEventListener('click', async (e) => {
  if (!$('#ed-blog-body').value.trim()) return toast('블로그 본문을 먼저 생성하세요', true);
  // 편집한 본문을 먼저 저장한 뒤 포스팅.
  await api(`/api/drafts/${currentDraft.id}/content`, { method: 'PUT', body: { content: collectEditedContent() } });
  busy(e.target, true, '네이버 임시저장 중… (CAPTCHA가 뜨면 열린 브라우저에서 풀어주세요)');
  const out = $('#naver-result');
  out.textContent = '';
  try {
    const { jobId } = await api(`/api/drafts/${currentDraft.id}/publish-naver`, { method: 'POST' });
    // 상태 폴링(최대 3분).
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const job = await api(`/api/naver-jobs/${jobId}`);
      out.textContent = `상태: ${job.status}${job.message ? ' — ' + job.message : ''}`;
      if (job.status === 'done') { toast('네이버 블로그에 임시저장되었습니다'); break; }
      if (job.status === 'error') { toast(job.message || '임시저장 실패', true); break; }
    }
  } catch (err) { toast(err.message, true); out.textContent = err.message; }
  finally { busy(e.target, false); }
});

$('#btn-publish-tistory').addEventListener('click', async (e) => {
  if (!$('#ed-blog-body').value.trim()) return toast('블로그 본문을 먼저 생성하세요', true);
  // 편집한 본문을 먼저 저장한 뒤 포스팅.
  await api(`/api/drafts/${currentDraft.id}/content`, { method: 'PUT', body: { content: collectEditedContent() } });
  busy(e.target, true, '티스토리 임시저장 중…');
  const out = $('#tistory-result');
  out.textContent = '';
  try {
    const result = await api(`/api/drafts/${currentDraft.id}/publish-tistory`, { method: 'POST' });
    out.textContent = result.message || (result.success ? '임시저장 완료' : '임시저장 실패');
    if (result.success) toast('티스토리에 임시저장되었습니다');
    else toast(result.message || '임시저장 실패', true);
  } catch (err) { toast(err.message, true); out.textContent = err.message; }
  finally { busy(e.target, false); }
});

// ---------- 발행 이력 ----------
async function loadPosts() {
  const posts = await api('/api/posts');
  const tbody = $('#post-table tbody');
  tbody.innerHTML = '';
  for (const p of posts) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.id}</td>
      <td>#${p.draft_id}</td>
      <td>${p.instagram_url ? `<a href="${p.instagram_url}" target="_blank">보기</a>` : '—'}</td>
      <td>${p.threads_url ? `<a href="${p.threads_url}" target="_blank">보기</a>` : '—'}</td>
      <td>${p.published_at}</td>`;
    tbody.appendChild(tr);
  }
}

// 초기 로드
loadSources();
