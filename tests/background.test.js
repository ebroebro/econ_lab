import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBackgrounds, buildBgPrompt } from '../src/renderer/background.js';

const CARDS = [
  { template: 'cover', title: '금리 동결' },
  { template: 'text', title: '본문' },
  { template: 'data', title: '추이', dataLabel: '2.5%' },
];

test('cover와 data 카드에만 배경 생성', async () => {
  const bgs = await generateBackgrounds(CARDS, async () => Buffer.from('png'));
  assert.deepEqual(Object.keys(bgs).map(Number), [0, 2]);
});

test('생성 실패 시 해당 카드 생략(폴백)', async () => {
  const bgs = await generateBackgrounds(CARDS, async () => null);
  assert.equal(Object.keys(bgs).length, 0);
});

test('예외가 나도 다른 카드는 계속 진행', async () => {
  let n = 0;
  const bgs = await generateBackgrounds(CARDS, async () => {
    n++;
    if (n === 1) throw new Error('quota');
    return Buffer.from('png');
  });
  assert.deepEqual(Object.keys(bgs).map(Number), [2]);
});

test('배경 프롬프트에 텍스트 금지 지시가 포함된다', () => {
  assert.ok(buildBgPrompt(CARDS[0]).toLowerCase().includes('no text'));
});
