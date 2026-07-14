import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postToNaverBlog } from '../src/publisher/naverBlog.js';

function fakeConnect(captured, toolText) {
  return async () => ({
    async callTool(args) { captured.push(args); return { content: [{ type: 'text', text: toolText }] }; },
    async close() { captured.push('closed'); },
  });
}

test('postToNaverBlog은 blocks로 변환해 publish:false로 툴을 호출하고 결과를 파싱한다', async () => {
  const captured = [];
  const res = await postToNaverBlog(
    { title: '제목', body: '문단\n[사진1]', imagePaths: ['/img/1.png'], tags: ['경제'] },
    { mcpDir: '/x', connect: fakeConnect(captured, JSON.stringify({ success: true, message: '임시저장 완료', post_url: null })) },
  );
  assert.equal(res.success, true);
  assert.equal(res.message, '임시저장 완료');
  const call = captured.find((c) => c && c.name === 'naver_blog_create_post');
  assert.equal(call.arguments.title, '제목');
  assert.equal(call.arguments.publish, false);
  assert.deepEqual(call.arguments.tags, ['경제']);
  assert.deepEqual(call.arguments.blocks, [
    { type: 'text', text: '문단\n' },
    { type: 'image', path: '/img/1.png' },
  ]);
  assert.ok(captured.includes('closed')); // 항상 close
});

test('mcpDir 미설정이면 success:false로 안내한다', async () => {
  const res = await postToNaverBlog({ title: 't', body: 'b', imagePaths: [], tags: [] }, { mcpDir: '' });
  assert.equal(res.success, false);
  assert.match(res.message, /NAVER_BLOG_MCP_DIR/);
});

test('툴이 JSON이 아닌 에러문을 반환하면 success:false로 감싼다', async () => {
  const captured = [];
  const res = await postToNaverBlog(
    { title: 't', body: 'b', imagePaths: [], tags: [] },
    { mcpDir: '/x', connect: fakeConnect(captured, '로그인 실패: CAPTCHA') },
  );
  assert.equal(res.success, false);
  assert.match(res.message, /CAPTCHA/);
});
