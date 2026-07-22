import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createServer } from '../src/web/server.js';
import { config } from '../src/config.js';

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

test('POST /api/drafts/manual — 업로드한 이미지로 바로 images_ready 초안이 만들어진다', async () => {
  const db6 = openDb(':memory:');
  const app6 = createServer(db6, {});
  const srv6 = app6.listen(0);
  try {
    const base6 = `http://127.0.0.1:${srv6.address().port}`;
    const fd = new FormData();
    fd.append('images', new Blob([Buffer.from('img1-bytes')], { type: 'image/png' }), 'a.png');
    fd.append('images', new Blob([Buffer.from('img2-bytes')], { type: 'image/png' }), 'b.jpg');
    fd.append('caption', '캡션입니다');
    fd.append('threadsText', '스레드 글');
    const r = await fetch(base6 + '/api/drafts/manual', { method: 'POST', body: fd });
    const draft = await r.json();
    assert.equal(r.status, 200);
    assert.equal(draft.status, 'images_ready');
    assert.equal(draft.content.manual, true);
    assert.equal(draft.content.caption, '캡션입니다');
    assert.equal(draft.content.cards.length, 2);

    const file1 = path.join(config.imagesDir, String(draft.id), 'card-1.png');
    const file2 = path.join(config.imagesDir, String(draft.id), 'card-2.png');
    assert.equal(fs.readFileSync(file1, 'utf8'), 'img1-bytes');
    assert.equal(fs.readFileSync(file2, 'utf8'), 'img2-bytes');
  } finally { srv6.close(); }
});

test('POST /api/drafts/manual — 이미지가 없으면 400', async () => {
  const db7 = openDb(':memory:');
  const app7 = createServer(db7, {});
  const srv7 = app7.listen(0);
  try {
    const base7 = `http://127.0.0.1:${srv7.address().port}`;
    const r = await fetch(base7 + '/api/drafts/manual', { method: 'POST', body: new FormData() });
    assert.equal(r.status, 400);
  } finally { srv7.close(); }
});

test('POST /api/drafts/:id/cards/:seq/image — 카드 한 장을 다른 이미지로 교체한다', async () => {
  const db8 = openDb(':memory:');
  const app8 = createServer(db8, {});
  const srv8 = app8.listen(0);
  try {
    const base8 = `http://127.0.0.1:${srv8.address().port}`;
    const fd = new FormData();
    fd.append('images', new Blob([Buffer.from('orig-1')], { type: 'image/png' }), 'a.png');
    fd.append('images', new Blob([Buffer.from('orig-2')], { type: 'image/png' }), 'b.png');
    let r = await fetch(base8 + '/api/drafts/manual', { method: 'POST', body: fd });
    const draft = await r.json();

    const fd2 = new FormData();
    fd2.append('image', new Blob([Buffer.from('replaced-1')], { type: 'image/png' }), 'new.png');
    r = await fetch(base8 + `/api/drafts/${draft.id}/cards/1/image`, { method: 'POST', body: fd2 });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.cards.length, 2);

    const file1 = path.join(config.imagesDir, String(draft.id), 'card-1.png');
    const file2 = path.join(config.imagesDir, String(draft.id), 'card-2.png');
    assert.equal(fs.readFileSync(file1, 'utf8'), 'replaced-1');
    assert.equal(fs.readFileSync(file2, 'utf8'), 'orig-2');
  } finally { srv8.close(); }
});

test('POST /api/drafts/:id/cards/:seq/image — 파일이 없으면 400, 존재하지 않는 초안이면 404', async () => {
  const db9 = openDb(':memory:');
  const app9 = createServer(db9, {});
  const srv9 = app9.listen(0);
  try {
    const base9 = `http://127.0.0.1:${srv9.address().port}`;
    let r = await fetch(base9 + '/api/drafts/999/cards/1/image', { method: 'POST', body: new FormData() });
    assert.equal(r.status, 404);

    const fd = new FormData();
    fd.append('images', new Blob([Buffer.from('x')], { type: 'image/png' }), 'a.png');
    r = await fetch(base9 + '/api/drafts/manual', { method: 'POST', body: fd });
    const draft = await r.json();

    r = await fetch(base9 + `/api/drafts/${draft.id}/cards/1/image`, { method: 'POST', body: new FormData() });
    assert.equal(r.status, 400);
  } finally { srv9.close(); }
});

test('POST /api/drafts/:id/blog — 블로그 본문을 생성해 초안에 저장한다', async () => {
  const dbB = openDb(':memory:');
  const appB = createServer(dbB, {
    generateContent: async () => ({ caption: 'c', cards: [{ template: 'cover', title: 't', body: '' }], threadsText: 'th' }),
    generateBlogDraft: async () => ({ blogTitle: '블로그제목', blogBody: '본문[사진1]', blogTags: ['경제'] }),
  });
  const srvB = appB.listen(0);
  try {
    const baseB = `http://127.0.0.1:${srvB.address().port}`;
    const sid = dbB.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(baseB + '/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sid] }) });
    const draft = await r.json();
    r = await fetch(baseB + `/api/drafts/${draft.id}/blog`, { method: 'POST' });
    const updated = await r.json();
    assert.equal(r.status, 200);
    assert.equal(updated.content.blogTitle, '블로그제목');
    assert.equal(updated.content.blogBody, '본문[사진1]');
  } finally { srvB.close(); }
});

test('publish-naver → jobId 반환, 잡 완료 후 status done', async () => {
  const dbC = openDb(':memory:');
  let posted = null;
  const appC = createServer(dbC, {
    generateContent: async () => ({ caption: 'c', cards: [{ template: 'cover', title: 't', body: '' }], threadsText: 'th' }),
    postToNaverBlog: async (input) => { posted = input; return { success: true, message: '임시저장 완료', postUrl: null }; },
  });
  const srvC = appC.listen(0);
  try {
    const baseC = `http://127.0.0.1:${srvC.address().port}`;
    const sid = dbC.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(baseC + '/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sid] }) });
    const draft = await r.json();
    dbC.updateDraftContent(draft.id, { ...draft.content, blogTitle: 'T', blogBody: '본문', blogTags: [] });
    r = await fetch(baseC + `/api/drafts/${draft.id}/publish-naver`, { method: 'POST' });
    const { jobId } = await r.json();
    assert.ok(jobId);
    let status;
    for (let i = 0; i < 50; i++) {
      const jr = await fetch(baseC + `/api/naver-jobs/${jobId}`);
      status = (await jr.json()).status;
      if (status === 'done' || status === 'error') break;
      await new Promise((res) => setTimeout(res, 20));
    }
    assert.equal(status, 'done');
    assert.equal(posted.title, 'T');
  } finally { srvC.close(); }
});

test('publish-naver — 블로그 본문 없으면 400', async () => {
  const dbD = openDb(':memory:');
  const appD = createServer(dbD, {
    generateContent: async () => ({ caption: 'c', cards: [{ template: 'cover', title: 't', body: '' }], threadsText: 'th' }),
  });
  const srvD = appD.listen(0);
  try {
    const baseD = `http://127.0.0.1:${srvD.address().port}`;
    const sid = dbD.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(baseD + '/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sid] }) });
    const draft = await r.json();
    r = await fetch(baseD + `/api/drafts/${draft.id}/publish-naver`, { method: 'POST' });
    assert.equal(r.status, 400);
  } finally { srvD.close(); }
});

test('POST /api/drafts/:id/publish-tistory — 블로그 본문을 임시저장하고 결과를 반환한다', async () => {
  const dbE = openDb(':memory:');
  let posted = null;
  const appE = createServer(dbE, {
    generateContent: async () => ({ caption: 'c', cards: [{ template: 'cover', title: 't', body: '' }], threadsText: 'th' }),
    postToTistory: async (input) => { posted = input; return { success: true, message: '임시저장 완료(sequence: 1)', postUrl: null }; },
  });
  const srvE = appE.listen(0);
  try {
    const baseE = `http://127.0.0.1:${srvE.address().port}`;
    const sid = dbE.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(baseE + '/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sid] }) });
    const draft = await r.json();
    dbE.updateDraftContent(draft.id, { ...draft.content, blogTitle: 'T', blogBody: '본문', blogTags: ['경제'] });
    r = await fetch(baseE + `/api/drafts/${draft.id}/publish-tistory`, { method: 'POST' });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.success, true);
    assert.equal(posted.title, 'T');
    assert.equal(posted.body, '본문');
    assert.deepEqual(posted.tags, ['경제']);
  } finally { srvE.close(); }
});

test('publish-tistory — 블로그 본문 없으면 400', async () => {
  const dbF = openDb(':memory:');
  const appF = createServer(dbF, {
    generateContent: async () => ({ caption: 'c', cards: [{ template: 'cover', title: 't', body: '' }], threadsText: 'th' }),
  });
  const srvF = appF.listen(0);
  try {
    const baseF = `http://127.0.0.1:${srvF.address().port}`;
    const sid = dbF.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(baseF + '/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sid] }) });
    const draft = await r.json();
    r = await fetch(baseF + `/api/drafts/${draft.id}/publish-tistory`, { method: 'POST' });
    assert.equal(r.status, 400);
  } finally { srvF.close(); }
});

test('publish — threadsPosts 배열이 있으면 배열 그대로 publishThreads에 전달한다', async () => {
  const dbG = openDb(':memory:');
  let receivedText = null;
  const appG = createServer(dbG, {
    generateContent: async () => ({
      caption: 'c',
      cards: [{ template: 'cover', title: 't', body: '' }],
      threadsPosts: ['첫 글', '둘째 글'],
    }),
    generateCardImage: async () => null,
    renderCards: async (draftId, cards) => cards.map((_, i) => `data/images/${draftId}/card-${i + 1}.png`),
    uploadImages: async (paths) => paths.map((_, i) => `https://cdn/x${i}.png`),
    publishInstagram: async () => ({ id: 'ig1', permalink: 'https://instagram.com/p/x' }),
    publishThreads: async ({ text }) => { receivedText = text; return { id: 'th1', permalink: 'https://threads.net/p/x' }; },
  });
  const srvG = appG.listen(0);
  try {
    const baseG = `http://127.0.0.1:${srvG.address().port}`;
    const sid = dbG.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(baseG + '/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sid] }) });
    const draft = await r.json();
    r = await fetch(baseG + `/api/drafts/${draft.id}/images`, { method: 'POST' });
    await r.json();
    r = await fetch(baseG + `/api/drafts/${draft.id}/publish`, { method: 'POST' });
    assert.equal(r.status, 200);
    assert.deepEqual(receivedText, ['첫 글', '둘째 글']);
  } finally { srvG.close(); }
});

test('publish — threadsPosts 없으면 기존 threadsText 문자열을 그대로 전달한다(하위 호환)', async () => {
  const dbH = openDb(':memory:');
  let receivedText = null;
  const appH = createServer(dbH, {
    generateContent: async () => ({
      caption: 'c',
      cards: [{ template: 'cover', title: 't', body: '' }],
      threadsText: '레거시 글',
    }),
    generateCardImage: async () => null,
    renderCards: async (draftId, cards) => cards.map((_, i) => `data/images/${draftId}/card-${i + 1}.png`),
    uploadImages: async (paths) => paths.map((_, i) => `https://cdn/x${i}.png`),
    publishInstagram: async () => ({ id: 'ig1', permalink: 'https://instagram.com/p/x' }),
    publishThreads: async ({ text }) => { receivedText = text; return { id: 'th1', permalink: 'https://threads.net/p/x' }; },
  });
  const srvH = appH.listen(0);
  try {
    const baseH = `http://127.0.0.1:${srvH.address().port}`;
    const sid = dbH.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(baseH + '/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sid] }) });
    const draft = await r.json();
    r = await fetch(baseH + `/api/drafts/${draft.id}/images`, { method: 'POST' });
    await r.json();
    r = await fetch(baseH + `/api/drafts/${draft.id}/publish`, { method: 'POST' });
    assert.equal(r.status, 200);
    assert.equal(receivedText, '레거시 글');
  } finally { srvH.close(); }
});

test('publish — threadsPosts가 빈 배열이고 threadsText도 없으면 publishThreads를 호출하지 않고 에러를 남긴다', async () => {
  const dbI = openDb(':memory:');
  const appI = createServer(dbI, {
    generateContent: async () => ({
      caption: 'c',
      cards: [{ template: 'cover', title: 't', body: '' }],
      threadsPosts: [],
    }),
    generateCardImage: async () => null,
    renderCards: async (draftId, cards) => cards.map((_, i) => `data/images/${draftId}/card-${i + 1}.png`),
    uploadImages: async (paths) => paths.map((_, i) => `https://cdn/x${i}.png`),
    publishInstagram: async () => ({ id: 'ig1', permalink: 'https://instagram.com/p/x' }),
    publishThreads: async () => { throw new Error('should not be called'); },
  });
  const srvI = appI.listen(0);
  try {
    const baseI = `http://127.0.0.1:${srvI.address().port}`;
    const sid = dbI.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(baseI + '/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sid] }) });
    const draft = await r.json();
    r = await fetch(baseI + `/api/drafts/${draft.id}/images`, { method: 'POST' });
    await r.json();
    r = await fetch(baseI + `/api/drafts/${draft.id}/publish`, { method: 'POST' });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.match(body.threads.error, /비어/);
  } finally { srvI.close(); }
});
