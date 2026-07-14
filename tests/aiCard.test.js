import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCardImagePrompt, generateCardImage } from '../src/renderer/aiCard.js';

test('cover 카드 프롬프트에 헤드라인·브랜드가 들어간다', () => {
  const p = buildCardImagePrompt(
    { template: 'cover', title: '코스피 7천 붕괴', meta: '2026년 7월 13일', body: '', tag: { text: '긴급속보', color: 'red' } },
    { brand: 'ECON LAB' }
  );
  assert.ok(p.includes('코스피 7천 붕괴'));
  assert.ok(p.includes('ECON LAB'));
  assert.ok(p.includes('긴급속보'));
  assert.ok(p.includes('2026년 7월 13일'));
});

test('chart 카드 프롬프트에 정확한 라벨/값이 그대로 들어간다', () => {
  const p = buildCardImagePrompt({
    template: 'chart', title: '코스피 추이', chartType: 'line',
    labels: ['7/12', '7/13'], values: [7475.94, 6806.93], unit: 'pt',
  });
  assert.ok(p.includes('7/12: 7475.94'));
  assert.ok(p.includes('7/13: 6806.93'));
  assert.ok(p.includes('no rounding'));
});

test('table 카드(columns) 프롬프트에 헤더·행이 그대로 들어간다', () => {
  const p = buildCardImagePrompt({
    template: 'table', title: '지수 현황',
    columns: ['구분', '변동률'], rows: [['코스피', '-8.95%']],
  });
  assert.ok(p.includes('구분 | 변동률'));
  assert.ok(p.includes('코스피 | -8.95%'));
});

test('data 카드 프롬프트에 강조 숫자와 색상이 들어간다', () => {
  const p = buildCardImagePrompt({ template: 'data', title: '환율', dataLabel: '1,495원', dataColor: 'red' });
  assert.ok(p.includes('1,495원'));
  assert.ok(p.includes('red number'));
});

test('text/역할 카드 프롬프트에 role별 일러스트 힌트가 들어간다', () => {
  const p = buildCardImagePrompt({ template: 'text', title: '왜 급락했나', body: '설명', role: 'hook' });
  assert.ok(p.includes('magnifying glass'));
});

test('모든 카드 프롬프트에 텍스트 환각·중복 방지 지시가 들어간다', () => {
  const p = buildCardImagePrompt({ template: 'cover', title: '제목', body: '' });
  assert.ok(p.includes('Do not invent'));
  assert.ok(p.includes('exactly once'));
});

test('generateCardImage은 성공하면 버퍼를 반환한다', async () => {
  const fakeBuf = Buffer.from('png-bytes');
  const buf = await generateCardImage({ template: 'cover', title: 't' }, { imageFn: async () => fakeBuf });
  assert.equal(buf, fakeBuf);
});

test('generateCardImage은 예외가 나면 null을 반환한다(throw하지 않음)', async () => {
  const buf = await generateCardImage({ template: 'cover', title: 't' }, { imageFn: async () => { throw new Error('quota'); } });
  assert.equal(buf, null);
});
