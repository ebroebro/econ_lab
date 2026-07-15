import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBlocks } from '../src/publisher/naverBlocks.js';

test('본문에 [사진N] 위치마다 해당 이미지 블록이 순서대로 들어간다', () => {
  const blocks = buildBlocks('도입 문단\n[사진1]\n다음 문단\n[사진2]', ['/img/card-1.png', '/img/card-2.png']);
  assert.deepEqual(blocks, [
    { type: 'text', text: '도입 문단\n' },
    { type: 'image', path: '/img/card-1.png' },
    { type: 'text', text: '\n다음 문단\n' },
    { type: 'image', path: '/img/card-2.png' },
  ]);
});

test('[구분선] 마커는 divider 블록이 되고 선두·말미·연속은 억제된다', () => {
  const blocks = buildBlocks('[구분선]앞[구분선][구분선]뒤[구분선]', []);
  assert.deepEqual(blocks, [
    { type: 'text', text: '앞' },
    { type: 'divider' },
    { type: 'text', text: '뒤' },
  ]);
});

test('[인용구]...[/인용구]는 quote 블록이 된다', () => {
  const blocks = buildBlocks('설명\n[인용구]외국인 -4,147억[/인용구]\n마무리', []);
  assert.deepEqual(blocks, [
    { type: 'text', text: '설명\n' },
    { type: 'quote', text: '외국인 -4,147억' },
    { type: 'text', text: '\n마무리' },
  ]);
});

test('매핑되지 않는 [사진N](이미지 부족)은 무시된다', () => {
  const blocks = buildBlocks('가[사진2]나', ['/img/card-1.png']);
  assert.deepEqual(blocks, [{ type: 'text', text: '가나' }]);
});
