import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseContent, generateDraftContent } from '../src/generator/content.js';

const SAMPLE = JSON.stringify({
  caption: '오늘의 기준금리 소식 📉 #부동산 #기준금리',
  cards: [
    { template: 'cover', title: '기준금리 2.5% 동결', body: '' },
    { template: 'text', title: '무슨 일?', body: '한국은행이 기준금리를 동결했습니다.' },
    { template: 'outro', title: '팔로우하고 매일 경제 소식 받기', body: '@내계정' },
  ],
  threadsText: '기준금리 동결. 자세한 카드뉴스는 인스타그램에서 → 프로필 링크',
});

test('buildPrompt에 소스 제목과 규칙이 들어간다', () => {
  const p = buildPrompt([{ type: 'news', title: '금리 동결', summary: '한은…', data: null }]);
  assert.ok(p.includes('금리 동결'));
  assert.ok(p.includes('투자 조언'));
});

test('parseContent가 마크다운 펜스를 벗겨 JSON을 파싱한다', () => {
  const c = parseContent('```json\n' + SAMPLE + '\n```');
  assert.equal(c.cards.length, 3);
  assert.equal(c.cards[0].template, 'cover');
});

test('cards 없으면 throw', () => {
  assert.throws(() => parseContent('{"caption":"x"}'));
});

test('generateDraftContent가 genFn 결과를 파싱해 반환', async () => {
  const c = await generateDraftContent([{ type: 'manual', title: 't', summary: '', data: null }], async () => SAMPLE);
  assert.equal(c.threadsText.includes('인스타그램'), true);
});
