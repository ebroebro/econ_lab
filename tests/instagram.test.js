import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishToInstagram } from '../src/publisher/instagram.js';

test('캐러셀 발행: 자식 컨테이너 → 캐러셀 → publish → permalink', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes('media_publish')) return { ok: true, json: async () => ({ id: 'post1' }) };
    if (url.includes('fields=permalink')) return { ok: true, json: async () => ({ permalink: 'https://instagram.com/p/x' }) };
    return { ok: true, json: async () => ({ id: 'c' + calls.length }) };
  };
  const r = await publishToInstagram(
    { imageUrls: ['https://a/1.png', 'https://a/2.png'], caption: '캡션' },
    fakeFetch, { igUserId: 'U', igAccessToken: 'T' });
  assert.ok(r.permalink.includes('instagram.com'));
  const mediaCalls = calls.filter(u => u.includes('/media?'));
  assert.equal(mediaCalls.length, 3); // 자식 2 + 캐러셀 1
  assert.ok(mediaCalls[2].includes('media_type=CAROUSEL'));
});

test('단일 이미지는 캐러셀 없이 발행', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes('media_publish')) return { ok: true, json: async () => ({ id: 'post1' }) };
    if (url.includes('fields=permalink')) return { ok: true, json: async () => ({ permalink: 'https://instagram.com/p/y' }) };
    return { ok: true, json: async () => ({ id: 'c1' }) };
  };
  await publishToInstagram({ imageUrls: ['https://a/1.png'], caption: 'c' },
    fakeFetch, { igUserId: 'U', igAccessToken: 'T' });
  assert.equal(calls.filter(u => u.includes('CAROUSEL')).length, 0);
});

test('API 오류 시 단계명 포함 오류', async () => {
  const fakeFetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'bad token' } }) });
  await assert.rejects(
    () => publishToInstagram({ imageUrls: ['https://a/1.png'], caption: 'c' }, fakeFetch, { igUserId: 'U', igAccessToken: 'T' }),
    /instagram:container/);
});
