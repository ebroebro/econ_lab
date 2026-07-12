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
const TYPE_LABEL = { news: '뉴스', realestate: '부동산', stock: '증시', manual: '직접 입력' };

async function loadSources() {
  const type = $('#src-type-filter').value;
  const sources = await api(`/api/sources?status=new${type ? `&type=${type}` : ''}`);
  const list = $('#source-list');
  list.innerHTML = '';
  if (!sources.length) {
    list.innerHTML = '<p style="color:#5c6b7a">소스가 없습니다. [지금 수집]을 누르거나 주제를 직접 입력하세요.</p>';
    return;
  }
  for (const s of sources) {
    const card = document.createElement('div');
    card.className = 'src-card' + (selectedSources.has(s.id) ? ' selected' : '');
    card.innerHTML = `
      <div class="src-head">
        <span class="badge ${s.type}">${TYPE_LABEL[s.type] || s.type}</span>
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
      $('#btn-create-draft').disabled = selectedSources.size === 0;
    });
    list.appendChild(card);
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

$('#btn-create-draft').addEventListener('click', async (e) => {
  busy(e.target, true, 'Gemini 글 생성 중…');
  try {
    const draft = await api('/api/drafts', { method: 'POST', body: { sourceIds: [...selectedSources] } });
    selectedSources.clear();
    toast('초안이 생성되었습니다');
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'drafts'));
    $$('.panel').forEach(p => p.hidden = true);
    $('#tab-drafts').hidden = false;
    openDraft(draft.id);
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

function renderDraftDetail() {
  const d = currentDraft;
  $('#draft-status').innerHTML = `<span class="badge st-${d.status}">${ST_LABEL[d.status] || d.status}</span> <span class="src-meta">초안 #${d.id}</span>`;
  const wrap = $('#card-editors');
  wrap.innerHTML = '';
  (d.content?.cards || []).forEach((c, i) => {
    const ed = document.createElement('div');
    ed.className = 'card-editor';
    ed.innerHTML = `
      <label>카드 ${i + 1} · ${c.template}</label>
      <input data-i="${i}" data-f="title" placeholder="제목">
      <textarea data-i="${i}" data-f="body" rows="2" placeholder="본문"></textarea>
      ${c.template === 'data' ? `<input data-i="${i}" data-f="dataLabel" placeholder="수치 (예: 2.5%)">` : ''}`;
    ed.querySelector('[data-f="title"]').value = c.title || '';
    ed.querySelector('[data-f="body"]').value = c.body || '';
    const dl = ed.querySelector('[data-f="dataLabel"]');
    if (dl) dl.value = c.dataLabel || '';
    wrap.appendChild(ed);
  });
  $('#ed-caption').value = d.content?.caption || '';
  $('#ed-threads').value = d.content?.threadsText || '';
  $('#btn-publish').disabled = d.status !== 'images_ready';
  $('#publish-result').innerHTML = '';
}

function collectEditedContent() {
  const d = currentDraft;
  const cards = (d.content?.cards || []).map((c, i) => ({ ...c }));
  $$('#card-editors [data-i]').forEach(el => {
    cards[Number(el.dataset.i)][el.dataset.f] = el.value;
  });
  return { ...d.content, cards, caption: $('#ed-caption').value, threadsText: $('#ed-threads').value };
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
    const img = document.createElement('img');
    img.src = `/images/${currentDraft.id}/card-${c.seq}.png?t=${Date.now()}`;
    prev.appendChild(img);
  }
}

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
