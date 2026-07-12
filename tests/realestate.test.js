import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { collectRealEstate } from '../src/collectors/realestate.js';

test('키 없으면 건너뛴다', async () => {
  const db = openDb(':memory:');
  assert.equal(await collectRealEstate(db, ''), 0);
});

test('기준금리를 realestate 소스로 저장, 같은 달 중복 방지', async () => {
  const db = openDb(':memory:');
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ StatisticSearch: { row: [
      { TIME: '202605', DATA_VALUE: '2.75' },
      { TIME: '202606', DATA_VALUE: '2.5' },
    ] } }),
  });
  await collectRealEstate(db, 'KEY', fakeFetch);
  await collectRealEstate(db, 'KEY', fakeFetch);
  const rows = db.listSources({ type: 'realestate' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].data.rates.length, 2);
});
