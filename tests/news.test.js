import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { collectNews } from '../src/collectors/news.js';

test('RSS 아이템을 sources에 저장하고 중복은 건너뛴다', async () => {
  const db = openDb(':memory:');
  const fakeParser = {
    parseURL: async () => ({
      items: [
        { title: '기준금리 동결', link: 'https://n.com/1', contentSnippet: '한은이…' },
        { title: '기준금리 동결', link: 'https://n.com/1', contentSnippet: '중복' },
      ],
    }),
  };
  const count = await collectNews(db, fakeParser);
  assert.equal(db.listSources({ type: 'news' }).length, 1);
  assert.equal(count >= 1, true);
});
