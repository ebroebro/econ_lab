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

test('배열 입력 시 실제 쓰레드로 답글 체인을 발행한다', async () => {
  const calls = [];
  let n = 0;
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes('threads_publish')) { n++; return { ok: true, json: async () => ({ id: `pub${n}` }) }; }
    if (url.includes('fields=permalink')) return { ok: true, json: async () => ({ permalink: `https://threads.net/@u/post/${n}` }) };
    return { ok: true, json: async () => ({ id: `container${n}` }) };
  };
  const r = await publishToThreads(
    { text: ['1번째 글이야', '2번째 글', '3번째 글'], imageUrl: 'https://a/1.png' },
    fakeFetch, { threadsUserId: 'U', threadsAccessToken: 'T' },
  );
  assert.ok(r.permalink.includes('threads'));
  assert.equal(r.id, 'pub1');

  const containerCalls = calls.filter((u) => u.includes('/threads?') && !u.includes('threads_publish'));
  assert.equal(containerCalls.length, 3);
  assert.ok(containerCalls[0].includes('media_type=IMAGE'));
  assert.ok(!containerCalls[0].includes('reply_to_id'));
  assert.ok(containerCalls[1].includes('media_type=TEXT'));
  assert.ok(containerCalls[1].includes('reply_to_id=pub1'));
  assert.ok(!containerCalls[1].includes('image_url'));
  assert.ok(containerCalls[2].includes('reply_to_id=pub2'));
});

test('빈 문자열이 섞인 배열은 걸러내고 발행한다', async () => {
  const calls = [];
  let n = 0;
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes('threads_publish')) { n++; return { ok: true, json: async () => ({ id: `pub${n}` }) }; }
    if (url.includes('fields=permalink')) return { ok: true, json: async () => ({ permalink: 'https://threads.net/@u/post/z' }) };
    return { ok: true, json: async () => ({ id: `container${n}` }) };
  };
  await publishToThreads(
    { text: ['첫 글', '', '  ', '둘째 글'] },
    fakeFetch, { threadsUserId: 'U', threadsAccessToken: 'T' },
  );
  const containerCalls = calls.filter((u) => u.includes('/threads?') && !u.includes('threads_publish'));
  assert.equal(containerCalls.length, 2);
});
