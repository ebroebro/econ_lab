import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseContent, generateDraftContent, buildStoryPrompt, parseStoryContent, generateStoryDraft, buildBlogPrompt, parseBlogContent } from '../src/generator/content.js';

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

test('buildStoryPrompt에 STEP1/STEP2 공식과 role 목록이 들어간다', () => {
  const p = buildStoryPrompt([{ type: 'news', title: '코스피 급락', summary: '반도체 우려', data: null }]);
  assert.ok(p.includes('코스피 급락'));
  assert.ok(p.includes('hook'));
  assert.ok(p.includes('marketImpact'));
  assert.ok(p.includes('koreaImpact'));
  assert.ok(p.includes('checklist'));
  assert.ok(p.includes('summary'));
  assert.ok(p.includes('가능성'));
});

test('parseStoryContent가 role을 정규화하고 잘못된 값은 cause로 보정한다', () => {
  const raw = JSON.stringify({
    caption: 'c', threadsText: 't',
    cards: [
      { template: 'text', role: 'hook', title: '궁금증', body: '본문', oneLiner: '요약' },
      { template: 'text', role: 'invalid-role', title: '뭔가', body: '본문' },
    ],
  });
  const c = parseStoryContent(raw);
  assert.equal(c.cards[0].role, 'hook');
  assert.equal(c.cards[0].oneLiner, '요약');
  assert.equal(c.cards[1].role, 'cause');
  assert.equal(c.cards[1].oneLiner, '');
});

test('generateStoryDraft가 genFn 결과를 파싱해 반환', async () => {
  const raw = JSON.stringify({
    caption: 'c', threadsText: 't',
    cards: [{ template: 'text', role: 'summary', title: '요약', body: '본문' }],
  });
  const c = await generateStoryDraft([{ type: 'manual', title: 't', summary: '', data: null }], async () => raw);
  assert.equal(c.cards[0].role, 'summary');
});

test('parseStoryContent가 steps/conclusion을 정규화한다', () => {
  const raw = JSON.stringify({
    caption: 'c', threadsText: 't',
    cards: [{ template: 'text', role: 'cause', title: '원인', body: '본문', steps: ['중동 긴장', '유가 상승', '', '인플레 우려'], conclusion: '주식시장 하락' }],
  });
  const c = parseStoryContent(raw);
  assert.deepEqual(c.cards[0].steps, ['중동 긴장', '유가 상승', '인플레 우려']);
  assert.equal(c.cards[0].conclusion, '주식시장 하락');
});

test('parseStoryContent는 steps가 없으면 conclusion도 빈 문자열로 만든다', () => {
  const raw = JSON.stringify({
    caption: 'c', threadsText: 't',
    cards: [{ template: 'text', role: 'summary', title: '요약', body: '본문', conclusion: '유령 결론' }],
  });
  const c = parseStoryContent(raw);
  assert.deepEqual(c.cards[0].steps, []);
  assert.equal(c.cards[0].conclusion, '');
});

test('parseStoryContent가 stats를 정확히 2개일 때만 채운다', () => {
  const raw1 = JSON.stringify({
    caption: 'c', threadsText: 't',
    cards: [{ template: 'text', role: 'marketImpact', title: '매도', body: '본문', stats: [{ label: '외국인', value: '-4,147억' }, { label: '기관', value: '-4,415억' }] }],
  });
  const c1 = parseStoryContent(raw1);
  assert.deepEqual(c1.cards[0].stats, [{ label: '외국인', value: '-4,147억' }, { label: '기관', value: '-4,415억' }]);

  const raw2 = JSON.stringify({
    caption: 'c', threadsText: 't',
    cards: [{ template: 'text', role: 'summary', title: '요약', body: '본문', stats: [{ label: '외국인', value: '-1' }] }],
  });
  const c2 = parseStoryContent(raw2);
  assert.deepEqual(c2.cards[0].stats, []);
});

test('buildBlogPrompt는 카드 수만큼 [사진N] 사용을 지시한다', () => {
  const p = buildBlogPrompt(
    [{ type: 'news', title: '코스피 급락', summary: '외국인 매도' }],
    [{ title: '삼전 급반전' }, { title: '반도체 부활' }, { title: '요약' }],
  );
  assert.match(p, /\[사진1\]/);
  assert.match(p, /\[사진3\]/);
  assert.ok(!p.includes('[사진4]'));
});

test('parseBlogContent는 blogTitle/blogBody/blogTags를 보정해 반환한다', () => {
  const raw = '```json\n{"blogTitle":"제목","blogBody":"문단\\n[사진1]","blogTags":["경제","코스피",123]}\n```';
  const r = parseBlogContent(raw);
  assert.equal(r.blogTitle, '제목');
  assert.equal(r.blogBody, '문단\n[사진1]');
  assert.deepEqual(r.blogTags, ['경제', '코스피', '123']);
});

test('parseBlogContent는 blogTitle/blogBody 누락 시 예외', () => {
  assert.throws(() => parseBlogContent('{"blogTags":[]}'));
});
