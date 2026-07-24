import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCardImagePrompt, generateCardImage } from '../src/renderer/aiCard.js';

test('cover 카드 프롬프트에 헤드라인·태그가 들어간다', () => {
  const p = buildCardImagePrompt(
    { template: 'cover', title: '코스피 7천 붕괴', meta: '2026년 7월 13일', body: '', tag: { text: '긴급속보', color: 'red' } },
    { seq: 1, total: 5 }
  );
  assert.ok(p.includes('코스피 7천 붕괴'));
  assert.ok(p.includes('긴급속보'));
  assert.ok(p.includes('2026년 7월 13일'));
});

test('번호배지·MARKET BRIEF·Swipe·하단 디스클레이머는 더 이상 프롬프트에 들어가지 않는다 (프레임 합성 단계로 이동)', () => {
  const p = buildCardImagePrompt({ template: 'cover', title: 't', body: '' }, { seq: 1, total: 3, handle: '@econ_lab_kr' });
  assert.ok(!p.includes('MARKET BRIEF'));
  assert.ok(!p.includes('Swipe'));
  assert.ok(!p.includes('투자 유의'));
  assert.ok(!p.includes('@econ_lab_kr'));
});

test('프롬프트에 프레임 합성을 위한 상단/하단 전체 폭 여백 확보 지시가 들어간다', () => {
  const p = buildCardImagePrompt({ template: 'cover', title: 't', body: '' });
  assert.ok(p.includes('safe zone') || p.includes('safe zones'));
  assert.ok(p.includes('TOP edge'));
  assert.ok(p.includes('BOTTOM edge'));
});

test('프롬프트에 번호 배지를 그리지 말라는 명시적 금지 지시가 들어간다', () => {
  const p = buildCardImagePrompt({ template: 'cover', title: 't', body: '' });
  assert.ok(p.includes('Do NOT draw any numbered badge'));
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

test('subscription 카드 프롬프트에 지역·총세대수·접수기간·발표일이 들어간다', () => {
  const p = buildCardImagePrompt({
    template: 'subscription', title: '남양주왕숙 A-24블록', region: '경기', totalSupply: '390세대',
    receiptStart: '2025.12.08', receiptEnd: '2025.12.12', winnerDate: '2025.12.24',
  });
  assert.ok(p.includes('남양주왕숙 A-24블록'));
  assert.ok(p.includes('경기'));
  assert.ok(p.includes('390세대'));
  assert.ok(p.includes('2025.12.08'));
  assert.ok(p.includes('2025.12.24'));
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
