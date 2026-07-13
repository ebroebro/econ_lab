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
  const c = await generateDraftContent([{ type: 'manual', title: 't', summary: '', data: null }], null, async () => SAMPLE);
  assert.equal(c.threadsText.includes('인스타그램'), true);
});

test('cardTypes가 주어지면 프롬프트에 타입별 스펙이 들어간다', () => {
  const p = buildPrompt(
    [{ type: 'news', title: '금리 동결', summary: '한은…', data: null }],
    ['cover', 'chart', 'table', 'outro']
  );
  assert.ok(p.includes('정확히 4장'));
  assert.ok(p.includes('cover → chart → table → outro'));
  assert.ok(p.includes('"chartType"'));
  assert.ok(p.includes('"rows"'));
});

test('parseContent가 chart 카드의 라벨/값 길이 불일치를 빈 배열로 초기화한다', () => {
  const raw = JSON.stringify({
    caption: 'c', threadsText: 't',
    cards: [{ template: 'chart', title: '추이', labels: ['1월', '2월'], values: [1] }],
  });
  const c = parseContent(raw);
  assert.deepEqual(c.cards[0].labels, []);
  assert.deepEqual(c.cards[0].values, []);
});

test('parseContent가 chart 카드 기본값(chartType, unit)을 채운다', () => {
  const raw = JSON.stringify({
    caption: 'c', threadsText: 't',
    cards: [{ template: 'chart', title: '추이', labels: ['1월'], values: [1] }],
  });
  const c = parseContent(raw);
  assert.equal(c.cards[0].chartType, 'line');
  assert.equal(c.cards[0].unit, '');
});

test('parseContent가 table 카드의 행에 기본값을 채운다', () => {
  const raw = JSON.stringify({
    caption: 'c', threadsText: 't',
    cards: [{ template: 'table', title: '순위', rows: [{ label: '강남구', value: '10건' }] }],
  });
  const c = parseContent(raw);
  assert.equal(c.cards[0].rows[0].rank, 1);
  assert.equal(c.cards[0].rows[0].delta, '');
});

test('parseContent가 table 카드에 rows가 없으면 빈 배열로 채운다', () => {
  const raw = JSON.stringify({ caption: 'c', threadsText: 't', cards: [{ template: 'table', title: '순위' }] });
  const c = parseContent(raw);
  assert.deepEqual(c.cards[0].rows, []);
});
