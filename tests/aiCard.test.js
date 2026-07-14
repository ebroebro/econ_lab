import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCardImagePrompt, generateCardImage } from '../src/renderer/aiCard.js';

test('cover 카드 프롬프트에 헤드라인·태그·번호배지·MARKET BRIEF가 들어간다', () => {
  const p = buildCardImagePrompt(
    { template: 'cover', title: '코스피 7천 붕괴', meta: '2026년 7월 13일', body: '', tag: { text: '긴급속보', color: 'red' } },
    { seq: 1, total: 5 }
  );
  assert.ok(p.includes('코스피 7천 붕괴'));
  assert.ok(p.includes('MARKET BRIEF'));
  assert.ok(p.includes('bold white number "1"'));
  assert.ok(p.includes('긴급속보'));
  assert.ok(p.includes('2026년 7월 13일'));
});

test('첫 번째 카드(seq 1)이고 total이 1보다 크면 Swipe 안내가 들어간다', () => {
  const p = buildCardImagePrompt({ template: 'cover', title: 't', body: '' }, { seq: 1, total: 3 });
  assert.ok(p.includes('Swipe'));
});

test('첫 카드가 아니면 Swipe 안내가 없다', () => {
  const p = buildCardImagePrompt({ template: 'cover', title: 't', body: '' }, { seq: 2, total: 3 });
  assert.ok(!p.includes('Swipe'));
});

test('모든 카드 프롬프트 하단에 투자 유의 디스클레이머와 계정 핸들이 들어간다', () => {
  const p = buildCardImagePrompt({ template: 'cover', title: 't', body: '' }, { handle: '@econ_lab_kr' });
  assert.ok(p.includes('투자 유의'));
  assert.ok(p.includes('@econ_lab_kr'));
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

test('text 카드에 steps가 있으면 플로우차트 지시가 들어가고 role 일러스트는 빠진다', () => {
  const p = buildCardImagePrompt({
    template: 'text', title: '왜 급락했나', body: '부연 설명', role: 'cause',
    steps: ['중동 긴장 고조', '유가 상승 우려', '인플레이션 우려'], conclusion: '주식시장 하락',
  });
  assert.ok(p.includes('중동 긴장 고조'));
  assert.ok(p.includes('유가 상승 우려'));
  assert.ok(p.includes('주식시장 하락'));
  assert.ok(p.includes('flowchart'));
  assert.ok(!p.includes('magnifying glass')); // steps가 있으면 role 일러스트 대신 플로우차트
});

test('text 카드에 stats가 정확히 2개면 비교 박스 지시가 들어간다', () => {
  const p = buildCardImagePrompt({
    template: 'text', title: '매도 규모', role: 'marketImpact',
    stats: [{ label: '외국인', value: '-4,147억' }, { label: '기관', value: '-4,415억' }],
  });
  assert.ok(p.includes('외국인'));
  assert.ok(p.includes('-4,147억'));
  assert.ok(p.includes('기관'));
  assert.ok(p.includes('side-by-side'));
});

test('steps/stats가 둘 다 없는 text 카드는 기존처럼 role 일러스트를 쓴다', () => {
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
