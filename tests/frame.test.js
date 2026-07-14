import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrameHtml, compositeCardFrames } from '../src/renderer/frame.js';

test('buildFrameHtml에 MARKET BRIEF·디스클레이머·계정 핸들이 고정 CSS 위치로 들어간다', () => {
  const html = buildFrameHtml('AAAA', { seq: 2, total: 5, handle: '@econ_lab_kr' });
  assert.ok(html.includes('MARKET BRIEF'));
  assert.ok(html.includes('투자 유의'));
  assert.ok(html.includes('@econ_lab_kr'));
  assert.ok(html.includes('data:image/png;base64,AAAA'));
});

test('번호 배지는 그리지 않고, AI가 상단에 그렸을 수 있는 내용을 흰색으로 덮어 지운다', () => {
  const html = buildFrameHtml('AAAA', { seq: 3, total: 5, handle: '@x' });
  assert.ok(!/class="badge"/.test(html));
  assert.ok(html.includes('top-mask'));
});

test('첫 카드(seq 1)이고 total이 1보다 크면 Swipe 안내가 들어간다', () => {
  const html = buildFrameHtml('AAAA', { seq: 1, total: 5, handle: '@x' });
  assert.ok(html.includes('Swipe'));
});

test('첫 카드가 아니면 Swipe 안내가 없다', () => {
  const html = buildFrameHtml('AAAA', { seq: 2, total: 5, handle: '@x' });
  assert.ok(!html.includes('Swipe'));
});

test('total이 1이면 첫 카드여도 Swipe 안내가 없다', () => {
  const html = buildFrameHtml('AAAA', { seq: 1, total: 1, handle: '@x' });
  assert.ok(!html.includes('Swipe'));
});

test('compositeCardFrames는 items와 같은 길이의 배열을 반환하고 빈 슬롯은 건너뛴다', async () => {
  const results = await compositeCardFrames([undefined, undefined]);
  assert.equal(results.length, 2);
  assert.equal(results[0], undefined);
  assert.equal(results[1], undefined);
});
