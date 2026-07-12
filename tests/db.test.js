import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';

test('source 삽입·중복 제거·상태 변경', () => {
  const db = openDb(':memory:');
  const id1 = db.insertSource({ type: 'news', title: '기사A', url: 'https://a.com/1', summary: '요약', data: null });
  const id2 = db.insertSource({ type: 'news', title: '기사A-중복', url: 'https://a.com/1', summary: '', data: null });
  assert.equal(id1, id2);
  db.updateSourceStatus(id1, 'used');
  assert.equal(db.listSources({ status: 'used' }).length, 1);
});

test('draft 생명주기', () => {
  const db = openDb(':memory:');
  const sid = db.insertSource({ type: 'manual', title: '주제', url: null, summary: '', data: null });
  const did = db.createDraft([sid]);
  db.updateDraftContent(did, { caption: '캡션', cards: [{ template: 'cover', title: '표지' }], threadsText: '스레드 글' });
  db.updateDraftStatus(did, 'text_approved');
  const d = db.getDraft(did);
  assert.equal(d.status, 'text_approved');
  assert.equal(d.content.caption, '캡션');
});

test('cards 저장·조회·삭제와 posts 기록', () => {
  const db = openDb(':memory:');
  const sid = db.insertSource({ type: 'manual', title: '주제', url: null, summary: '', data: null });
  const did = db.createDraft([sid]);
  db.saveCard({ draftId: did, seq: 1, template: 'cover', imagePath: 'a.png' });
  db.saveCard({ draftId: did, seq: 2, template: 'text', imagePath: 'b.png' });
  assert.equal(db.listCards(did).length, 2);
  db.deleteCards(did);
  assert.equal(db.listCards(did).length, 0);
  db.savePost({ draftId: did, instagramUrl: 'https://instagram.com/p/x' });
  assert.equal(db.listPosts().length, 1);
});
