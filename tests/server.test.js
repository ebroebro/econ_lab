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
  renderCards: async (draftId, cards) => cards.map((_, i) => `data/images/${draftId}/card-${i + 1}.png`),
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
