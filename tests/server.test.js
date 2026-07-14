import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createServer } from '../src/web/server.js';

const db = openDb(':memory:');
const app = createServer(db, {
  generateContent: async () => ({
    caption: 'c',
    cards: [{ template: 'cover', title: 't', body: '' }],
    threadsText: 'th',
  }),
  generateBackgrounds: async () => ({}),
  generateCardImage: async () => null,
  renderCards: async (draftId, cards, opts) => {
    const indices = opts?.only || cards.map((_, i) => i);
    const paths = new Array(cards.length);
    indices.forEach((i) => { paths[i] = `data/images/${draftId}/card-${i + 1}.png`; });
    return paths;
  },
  uploadImages: async (paths) => paths.map((_, i) => `https://cdn/x${i}.png`),
  publishInstagram: async () => ({ id: 'ig1', permalink: 'https://instagram.com/p/x' }),
  publishThreads: async () => { throw new Error('threads down'); },
});
const srv = app.listen(0);
const base = () => `http://127.0.0.1:${srv.address().port}`;
after(() => srv.close());

async function api(path, opts = {}) {
  const r = await fetch(base() + path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: r.status, json: await r.json() };
}

test('전체 흐름: 소스 등록 → 초안 → 검수 → 이미지 → 배포(부분 실패 기록)', async () => {
  // 1) 직접 입력 소스
  let r = await api('/api/sources', { method: 'POST', body: { title: '수동 주제', summary: '메모' } });
  const sourceId = r.json.id;
  assert.ok(sourceId > 0);

  // 2) 초안 생성 (글 생성)
  r = await api('/api/drafts', { method: 'POST', body: { sourceIds: [sourceId] } });
  const draft = r.json;
  assert.equal(draft.content.caption, 'c');

  // 소스가 used로 바뀜
  r = await api('/api/sources?status=used');
  assert.equal(r.json.length, 1);

  // 3) 글 수정 + 확정
  r = await api(`/api/drafts/${draft.id}/content`, { method: 'PUT', body: { content: { ...draft.content, caption: '수정됨' } } });
  assert.equal(r.json.content.caption, '수정됨');
  r = await api(`/api/drafts/${draft.id}/approve-text`, { method: 'POST' });
  assert.equal(r.json.status, 'text_approved');

  // 4) 이미지 생성
  r = await api(`/api/drafts/${draft.id}/images`, { method: 'POST' });
  assert.equal(r.json.cards.length, 1);

  // 5) 배포 — 인스타 성공, 스레드 실패 → 부분 성공 기록
  r = await api(`/api/drafts/${draft.id}/publish`, { method: 'POST' });
  assert.equal(r.status, 200);
  assert.ok(r.json.instagram.permalink.includes('instagram'));
  assert.equal(r.json.threads.error, 'threads down');

  r = await api('/api/posts');
  assert.equal(r.json.length, 1);
  assert.ok(r.json[0].instagram_url);
});

test('이미지 준비 전 배포는 400', async () => {
  let r = await api('/api/sources', { method: 'POST', body: { title: '주제2' } });
  r = await api('/api/drafts', { method: 'POST', body: { sourceIds: [r.json.id] } });
  const pub = await api(`/api/drafts/${r.json.id}/publish`, { method: 'POST' });
  assert.equal(pub.status, 400);
});

test('cardTypes를 보내면 generateContent에 그대로 전달된다', async () => {
  const received = [];
  const db2 = openDb(':memory:');
  const app2 = createServer(db2, {
    generateContent: async (sources, cardTypes) => {
      received.push(cardTypes);
      return { caption: 'c', cards: (cardTypes || ['cover']).map(t => ({ template: t, title: 't', body: '' })), threadsText: 'th' };
    },
  });
  const srv2 = app2.listen(0);
  try {
    const base2 = `http://127.0.0.1:${srv2.address().port}`;
    const sid = db2.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    const r = await fetch(base2 + '/api/drafts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceIds: [sid], cardTypes: ['cover', 'chart', 'outro'] }),
    });
    const draft = await r.json();
    assert.deepEqual(received[0], ['cover', 'chart', 'outro']);
    assert.equal(draft.content.cards.length, 3);
  } finally { srv2.close(); }
});

test('regenerate는 기존 카드 타입 순서를 유지해서 다시 생성한다', async () => {
  const received = [];
  const db3 = openDb(':memory:');
  const app3 = createServer(db3, {
    generateContent: async (sources, cardTypes) => {
      received.push(cardTypes);
      return { caption: 'c2', cards: (cardTypes || ['cover']).map(t => ({ template: t, title: 't2', body: '' })), threadsText: 'th2' };
    },
  });
  const srv3 = app3.listen(0);
  try {
    const base3 = `http://127.0.0.1:${srv3.address().port}`;
    const sid = db3.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(base3 + '/api/drafts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceIds: [sid], cardTypes: ['cover', 'table'] }),
    });
    const draft = await r.json();
    r = await fetch(base3 + `/api/drafts/${draft.id}/regenerate`, { method: 'POST' });
    await r.json();
    assert.deepEqual(received[1], ['cover', 'table']);
  } finally { srv3.close(); }
});

test('이미지 생성: AI 생성이 성공한 카드는 HTML 폴백 렌더를 타지 않는다', async () => {
  let renderCalled = false;
  const db4 = openDb(':memory:');
  const app4 = createServer(db4, {
    generateContent: async () => ({ caption: 'c', cards: [{ template: 'cover', title: 't', body: '' }], threadsText: 'th' }),
    generateCardImage: async () => Buffer.from('fake-png-bytes'),
    compositeCardFrames: async (items) => items.map((it) => it && it.buf),
    renderCards: async () => { renderCalled = true; return []; },
  });
  const srv4 = app4.listen(0);
  try {
    const base4 = `http://127.0.0.1:${srv4.address().port}`;
    const sid = db4.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(base4 + '/api/drafts', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sid] }),
    });
    const draft = await r.json();
    r = await fetch(base4 + `/api/drafts/${draft.id}/images`, { method: 'POST' });
    const body = await r.json();
    assert.equal(body.aiGenerated, 1);
    assert.equal(body.fallback, 0);
    assert.equal(renderCalled, false);
    assert.equal(body.cards.length, 1);
  } finally { srv4.close(); }
});

test('이미지 생성: AI 생성 실패 카드만 HTML 폴백 렌더로 넘어간다', async () => {
  const only = [];
  const db5 = openDb(':memory:');
  const app5 = createServer(db5, {
    generateContent: async () => ({
      caption: 'c',
      cards: [{ template: 'cover', title: 'A', body: '' }, { template: 'cover', title: 'B', body: '' }],
      threadsText: 'th',
    }),
    generateCardImage: async (card) => (card.title === 'A' ? Buffer.from('ok') : null),
    compositeCardFrames: async (items) => items.map((it) => it && it.buf),
    renderCards: async (draftId, cards, opts) => {
      only.push(opts?.only);
      const paths = new Array(cards.length);
      (opts?.only || []).forEach((i) => { paths[i] = `data/images/${draftId}/card-${i + 1}.png`; });
      return paths;
    },
  });
  const srv5 = app5.listen(0);
  try {
    const base5 = `http://127.0.0.1:${srv5.address().port}`;
    const sid = db5.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(base5 + '/api/drafts', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sid] }),
    });
    const draft = await r.json();
    r = await fetch(base5 + `/api/drafts/${draft.id}/images`, { method: 'POST' });
    const body = await r.json();
    assert.equal(body.aiGenerated, 1);
    assert.equal(body.fallback, 1);
    assert.deepEqual(only[0], [1]);
    assert.equal(body.cards.length, 2);
  } finally { srv5.close(); }
});
