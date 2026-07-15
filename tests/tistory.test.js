import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { postToTistory } from '../src/publisher/tistory.js';

// tistoryBlocks.js(Task 1)의 renderBlocksToHtml은 이미지 블록마다 실제 fs.readFileSync를
// 수행하므로, 목 uploadImage를 쓰더라도 경로 자체는 실존하는 파일이어야 한다
// (tests/tistoryBlocks.test.js와 동일한 패턴). 파일명은 buildBlocks가 만드는 순번(1.png)에 맞춘다.
let tmpDir;
let imgPath;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tistory-'));
  imgPath = path.join(tmpDir, '1.png');
  fs.writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG 시그니처만 있으면 충분
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function fakeLib({ saveDraftResult, initBlogError } = {}) {
  const calls = [];
  return {
    calls,
    lib: {
      async initBlog() {
        calls.push('initBlog');
        if (initBlogError) throw new Error(initBlogError);
      },
      async uploadImage(buffer, filename) {
        calls.push({ uploadImage: filename });
        return { url: 'https://t1.daumcdn.net/tistory_admin/dna/Xyz789' };
      },
      async saveDraft({ title, content }) {
        calls.push({ saveDraft: { title, content } });
        return saveDraftResult ?? { draft: { sequence: 42 } };
      },
    },
  };
}

test('postToTistory는 initBlog → buildBlocks → 이미지 업로드 → saveDraft 순서로 호출한다', async () => {
  const { lib, calls } = fakeLib();
  const res = await postToTistory(
    { title: '제목', body: '문단\n[사진1]', imagePaths: [imgPath], tags: ['경제'] },
    { viruagentDir: '/x', lib },
  );
  assert.equal(res.success, true);
  assert.match(res.message, /42/);
  assert.deepEqual(calls[0], 'initBlog');
  assert.deepEqual(calls[1], { uploadImage: '1.png' });
  const draftCall = calls[2].saveDraft;
  assert.equal(draftCall.title, '제목');
  assert.match(draftCall.content, /kage@Xyz789/);
});

test('viruagentDir 미설정이면 success:false로 안내한다', async () => {
  const res = await postToTistory({ title: 't', body: 'b', imagePaths: [], tags: [] }, { viruagentDir: '' });
  assert.equal(res.success, false);
  assert.match(res.message, /TISTORY_VIRUAGENT_DIR/);
});

test('세션 만료 등 initBlog 실패는 success:false로 감싼다', async () => {
  const { lib } = fakeLib({ initBlogError: '세션이 만료되었습니다. /login으로 다시 로그인하세요.' });
  const res = await postToTistory({ title: 't', body: 'b', imagePaths: [], tags: [] }, { viruagentDir: '/x', lib });
  assert.equal(res.success, false);
  assert.match(res.message, /세션이 만료/);
});

test('이미지 업로드 경고가 있으면 메시지에 포함되지만 success는 true다', async () => {
  const { lib } = fakeLib();
  lib.uploadImage = async () => { throw new Error('업로드 500'); };
  const res = await postToTistory(
    { title: '제목', body: '문단\n[사진1]', imagePaths: [imgPath], tags: [] },
    { viruagentDir: '/x', lib },
  );
  assert.equal(res.success, true);
  assert.match(res.message, /업로드 500/);
});
