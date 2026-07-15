import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderBlocksToHtml } from '../src/publisher/tistoryBlocks.js';

let tmpDir;
let imgPath;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tistory-blocks-'));
  imgPath = path.join(tmpDir, 'card-1.png');
  fs.writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG 시그니처만 있으면 충분
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('text 블록은 <p>로, 줄바꿈은 <br>로 변환된다', async () => {
  const { html } = await renderBlocksToHtml([{ type: 'text', text: '첫줄\n둘째줄' }], { uploadImage: async () => ({ url: '' }) });
  assert.equal(html, '<p>첫줄<br>둘째줄</p>');
});

test('divider 블록은 <hr>, quote 블록은 blockquote로 변환된다', async () => {
  const { html } = await renderBlocksToHtml(
    [{ type: 'divider' }, { type: 'quote', text: '핵심 수치' }],
    { uploadImage: async () => ({ url: '' }) },
  );
  assert.equal(html, '<hr>\n<blockquote><p>핵심 수치</p></blockquote>');
});

test('image 블록은 업로드 후 kage@ 치환자로 변환되고 첫 이미지가 thumbnailKage가 된다', async () => {
  const calls = [];
  const { html, thumbnailKage, warnings } = await renderBlocksToHtml(
    [{ type: 'image', path: imgPath }],
    { uploadImage: async (buffer, filename) => { calls.push(filename); return { url: 'https://t1.daumcdn.net/tistory_admin/dna/AbCdEf123' }; } },
  );
  assert.deepEqual(calls, ['card-1.png']);
  assert.equal(html, '<p>[##_Image|kage@AbCdEf123|CDM|1.3|{"originWidth":0,"originHeight":0,"style":"alignCenter"}_##]</p>');
  assert.equal(thumbnailKage, 'kage@AbCdEf123');
  assert.deepEqual(warnings, []);
});

test('이미지 업로드가 실패하면 해당 이미지만 건너뛰고 warnings에 기록한다', async () => {
  const { html, thumbnailKage, warnings } = await renderBlocksToHtml(
    [{ type: 'text', text: '앞' }, { type: 'image', path: imgPath }, { type: 'text', text: '뒤' }],
    { uploadImage: async () => { throw new Error('업로드 500'); } },
  );
  assert.equal(html, '<p>앞</p>\n<p>뒤</p>');
  assert.equal(thumbnailKage, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /card-1\.png/);
  assert.match(warnings[0], /업로드 500/);
});
