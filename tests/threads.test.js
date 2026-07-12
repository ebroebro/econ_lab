import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishToThreads } from '../src/publisher/threads.js';

test('이미지+텍스트 스레드 발행 2단계', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes('threads_publish')) return { ok: true, json: async () => ({ id: 'th1' }) };
    if (url.includes('fields=permalink')) return { ok: true, json: async () => ({ permalink: 'https://threads.net/@u/post/x' }) };
    return { ok: true, json: async () => ({ id: 'container1' }) };
  };
  const r = await publishToThreads({ text: '요약 글', imageUrl: 'https://a/1.png' },
    fakeFetch, { threadsUserId: 'U', threadsAccessToken: 'T' });
  assert.ok(r.permalink.includes('threads'));
  assert.ok(calls[0].includes('media_type=IMAGE'));
});

test('이미지 없으면 TEXT 게시', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes('threads_publish')) return { ok: true, json: async () => ({ id: 'th1' }) };
    if (url.includes('fields=permalink')) return { ok: true, json: async () => ({ permalink: 'https://threads.net/@u/post/y' }) };
    return { ok: true, json: async () => ({ id: 'container1' }) };
  };
  await publishToThreads({ text: '텍스트만' }, fakeFetch, { threadsUserId: 'U', threadsAccessToken: 'T' });
  assert.ok(calls[0].includes('media_type=TEXT'));
});
