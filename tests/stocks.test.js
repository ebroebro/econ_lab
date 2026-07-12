import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { collectStocks } from '../src/collectors/stocks.js';

test('증시 스냅샷을 stock 소스로 저장한다', async () => {
  const db = openDb(':memory:');
  const fakeFetch = async (url) => ({
    ok: true,
    json: async () => url.includes('KOSPI')
      ? { closePrice: '2,650.12', compareToPreviousClosePrice: '12.34', fluctuationsRatio: '0.47' }
      : { closePrice: '860.55', compareToPreviousClosePrice: '-3.21', fluctuationsRatio: '-0.37' },
  });
  const n = await collectStocks(db, fakeFetch);
  assert.equal(n, 1);
  const s = db.listSources({ type: 'stock' })[0];
  assert.equal(s.data.kospi.value, 2650.12);
});

test('네트워크 실패 시 0 반환하고 죽지 않는다', async () => {
  const db = openDb(':memory:');
  const n = await collectStocks(db, async () => { throw new Error('down'); });
  assert.equal(n, 0);
});
