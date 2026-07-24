import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { collectSubscriptions } from '../src/collectors/subscription.js';

test('키 없으면 건너뛴다', async () => {
  const db = openDb(':memory:');
  assert.equal(await collectSubscriptions(db, ''), 0);
});

test('청약 공고를 subscription 소스로 저장하고, 같은 공고 재수집 시 중복 저장하지 않는다', async () => {
  const db = openDb(':memory:');
  const item = {
    주택관리번호: 2025820017,
    주택명: '남양주왕숙 A-24블록 신혼희망타운(공공분양)(본청약)',
    공급지역명: '경기',
    공급규모: 390,
    청약접수시작일: '2025-12-08',
    청약접수종료일: '2025-12-12',
    당첨자발표일: '2025-12-24',
    모집공고일: '2025-11-27',
    모집공고홈페이지주소: 'https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancDetail.do?houseManageNo=2025820017&pblancNo=2025820017',
  };
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ data: [item], totalCount: 1, page: 1, perPage: 100, currentCount: 1, matchCount: 1 }),
  });

  await collectSubscriptions(db, 'KEY', fakeFetch);
  await collectSubscriptions(db, 'KEY', fakeFetch); // 재수집

  const rows = db.listSources({ type: 'subscription' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, item.주택명);
  assert.equal(rows[0].url, item.모집공고홈페이지주소);
  assert.match(rows[0].summary, /경기/);
  assert.match(rows[0].summary, /390/);
  assert.deepEqual(rows[0].data, {
    region: '경기', totalSupply: 390,
    receiptStart: '2025-12-08', receiptEnd: '2025-12-12',
    winnerDate: '2025-12-24', noticeDate: '2025-11-27',
  });
});

test('data 배열이 비어있으면 0건 반환', async () => {
  const db = openDb(':memory:');
  const fakeFetch = async () => ({ ok: true, json: async () => ({ data: [] }) });
  assert.equal(await collectSubscriptions(db, 'KEY', fakeFetch), 0);
});

test('API HTTP 오류 시 0건 반환하고 죽지 않는다', async () => {
  const db = openDb(':memory:');
  const fakeFetch = async () => ({ ok: false, status: 500 });
  assert.equal(await collectSubscriptions(db, 'KEY', fakeFetch), 0);
});

test('필드 값이 null이어도 안전한 기본값으로 정규화해 저장한다', async () => {
  const db = openDb(':memory:');
  const item = {
    주택관리번호: 111,
    주택명: '테스트단지',
    공급지역명: null,
    공급규모: null,
    청약접수시작일: null,
    청약접수종료일: null,
    당첨자발표일: null,
    모집공고일: null,
    모집공고홈페이지주소: 'https://example.com/111',
  };
  const fakeFetch = async () => ({ ok: true, json: async () => ({ data: [item] }) });
  await collectSubscriptions(db, 'KEY', fakeFetch);
  const rows = db.listSources({ type: 'subscription' });
  assert.deepEqual(rows[0].data, {
    region: '', totalSupply: 0, receiptStart: '', receiptEnd: '', winnerDate: '', noticeDate: '',
  });
});

test('모집공고홈페이지주소가 없는 항목은 건너뛴다', async () => {
  const db = openDb(':memory:');
  const fakeFetch = async () => ({ ok: true, json: async () => ({ data: [{ 주택명: '주소없음' }] }) });
  const saved = await collectSubscriptions(db, 'KEY', fakeFetch);
  assert.equal(saved, 0);
  assert.equal(db.listSources({ type: 'subscription' }).length, 0);
});
