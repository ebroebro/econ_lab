# Threads 답글 체인(실제 '쓰레드') 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Threads에 짧은 글 1개만 올라가던 것을, 후킹 있는 반말 톤의 연속된 글 2~4개가 실제 답글 체인("쓰레드")으로 이어지도록 확장한다. 인스타 캡션도 인플루언서 톤으로 손본다.

**Architecture:** `content.threadsText`(문자열) → `content.threadsPosts`(문자열 배열)로 데이터 모델을 바꾼다. `publishToThreads()`는 `text`가 배열이면 첫 글만 이미지와 함께 게시하고 나머지는 `reply_to_id`로 이전 글에 답글을 이어 붙이며, 문자열이면 기존과 완전히 동일하게 동작한다(하위 호환, 기존 테스트 무변경). 서버 라우트는 `threadsPosts`가 있으면 그걸, 없으면(과거 초안) `threadsText`를 그대로 넘긴다. UI는 고정 4칸 textarea로 바뀐다.

**Tech Stack:** 기존 프로젝트(Node ESM, Express 5, node:test, vanilla JS 프런트엔드).

## Global Constraints

- 기존 Instagram 배포 경로, 네이버/티스토리 블로그 배포 경로는 변경하지 않는다.
- `publishToThreads({ text, imageUrl }, fetchFn, creds)`의 문자열 입력 동작은 **한 글자도 바뀌지 않아야 한다** — 기존 `tests/threads.test.js`의 2개 테스트를 그대로 통과시킨다.
- `/api/drafts/manual`(다른 곳에서 만든 이미지 업로드) 경로는 건드리지 않는다 — 그 경로는 여전히 단일 `threadsText` 문자열을 쓰고, 발행 라우트의 하위 호환 분기가 이를 그대로 처리한다.
- 답글에는 이미지를 붙이지 않는다(루트 글에만 카드 이미지 1장).
- 캡션은 존댓말 기반 "친근하고 임팩트 있게", threadsPosts는 반말 — 톤을 서로 다르게 유지한다.
- DB 마이그레이션 스크립트를 만들지 않는다 — 과거 초안(threadsPosts 없음)은 UI/서버 양쪽에서 threadsText로 자연스럽게 폴백한다.
- Node ESM(`import`), 파일 상단 한글 주석은 "왜"를 설명(기존 코드 스타일 준수).

---

## File Structure

- **Modify `src/generator/content.js`** — `buildPrompt`/`buildStoryPrompt`의 caption/threadsText 지시문을 caption(인플루언서 톤)/threadsPosts(반말 쓰레드) 지시문으로 교체. `parseContent`의 필수 필드 검증·정규화를 `threadsText` → `threadsPosts`로 변경(`parseStoryContent`는 내부적으로 `parseContent`를 호출하므로 별도 수정 불필요).
- **Modify `src/publisher/threads.js`** — 단일 발행 로직을 `publishOnePost()` 내부 헬�퍼로 추출하고, `publishToThreads()`가 `text` 배열이면 답글 체인으로 발행하도록 분기 추가.
- **Modify `src/web/server.js`** — `POST /api/drafts/:id/publish`에서 `publishThreads`에 넘기는 `text`를 `threadsPosts` 우선, 없으면 `threadsText`로 선택.
- **Modify `src/web/public/index.html` / `app.js`** — Threads 글 textarea 1개를 고정 4칸으로. `style.css`에 여백 규칙 1줄 추가.
- **Tests:** `tests/content.test.js`(대량 갱신), `tests/threads.test.js`(배열 입력 테스트 추가), `tests/server.test.js`(threadsPosts/threadsText 선택 테스트 추가).

---

### Task 1: content.js — threadsPosts 생성·파싱

**Files:**
- Modify: `src/generator/content.js`
- Modify: `tests/content.test.js` (전체 교체)

**Interfaces:**
- Produces: `parseContent(text)`가 반환하는 객체의 `threadsPosts`는 항상 `string[]`(빈 문자열 제거, 최대 4개)이고 최소 1개 이상 있어야 하며, 없으면(또는 전부 빈 문자열이면) throw한다. `threadsText` 키는 더 이상 출력/검증하지 않는다.
- Consumes: 없음(이 태스크가 최상위).

- [ ] **Step 1: 실패 테스트 작성 — `tests/content.test.js` 전체를 아래 내용으로 교체**

```js
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
  threadsPosts: ['기준금리 동결됐어!', '자세한 카드뉴스는 인스타그램에서 확인'],
});

test('buildPrompt에 소스 제목과 규칙이 들어간다', () => {
  const p = buildPrompt([{ type: 'news', title: '금리 동결', summary: '한은…', data: null }]);
  assert.ok(p.includes('금리 동결'));
  assert.ok(p.includes('투자 조언'));
});

test('buildPrompt에 threadsPosts 지시문(반말·2~4개·마지막 글 유도문구)이 들어간다', () => {
  const p = buildPrompt([{ type: 'news', title: '금리 동결', summary: '한은…', data: null }]);
  assert.ok(p.includes('threadsPosts'));
  assert.ok(p.includes('반말'));
  assert.ok(p.includes('마지막 글'));
});

test('parseContent가 마크다운 펜스를 벗겨 JSON을 파싱한다', () => {
  const c = parseContent('```json\n' + SAMPLE + '\n```');
  assert.equal(c.cards.length, 3);
  assert.equal(c.cards[0].template, 'cover');
});

test('cards 없으면 throw', () => {
  assert.throws(() => parseContent('{"caption":"x"}'));
});

test('threadsPosts가 없거나 전부 빈 문자열이면 throw', () => {
  assert.throws(() => parseContent(JSON.stringify({ caption: 'c', cards: [{ template: 'text' }], threadsPosts: [] })));
  assert.throws(() => parseContent(JSON.stringify({ caption: 'c', cards: [{ template: 'text' }], threadsPosts: ['', '  '] })));
});

test('parseContent가 threadsPosts의 빈 문자열을 걸러내고 4개로 자른다', () => {
  const raw = JSON.stringify({
    caption: 'c', cards: [{ template: 'text' }],
    threadsPosts: ['1', '', '2', '3', '4', '5'],
  });
  const c = parseContent(raw);
  assert.deepEqual(c.threadsPosts, ['1', '2', '3', '4']);
});

test('generateDraftContent가 genFn 결과를 파싱해 반환', async () => {
  const c = await generateDraftContent([{ type: 'manual', title: 't', summary: '', data: null }], null, async () => SAMPLE);
  assert.equal(c.threadsPosts.some((t) => t.includes('인스타그램')), true);
});

test('cardTypes가 주어지면 프롬프트에 타입별 스펙이 들어간다', () => {
  const p = buildPrompt(
    [{ type: 'news', title: '금리 동결', summary: '한은…', data: null }],
    ['cover', 'chart', 'table', 'outro']
  );
  assert.ok(p.includes('최대 4장'));
  assert.ok(p.includes('cover → chart → table → outro'));
  assert.ok(p.includes('"chartType"'));
  assert.ok(p.includes('"rows"'));
});

test('parseContent가 chart 카드의 라벨/값 길이 불일치를 빈 배열로 초기화한다', () => {
  const raw = JSON.stringify({
    caption: 'c', threadsPosts: ['t'],
    cards: [{ template: 'chart', title: '추이', labels: ['1월', '2월'], values: [1] }],
  });
  const c = parseContent(raw);
  assert.deepEqual(c.cards[0].labels, []);
  assert.deepEqual(c.cards[0].values, []);
});

test('parseContent가 chart 카드 기본값(chartType, unit)을 채운다', () => {
  const raw = JSON.stringify({
    caption: 'c', threadsPosts: ['t'],
    cards: [{ template: 'chart', title: '추이', labels: ['1월'], values: [1] }],
  });
  const c = parseContent(raw);
  assert.equal(c.cards[0].chartType, 'line');
  assert.equal(c.cards[0].unit, '');
});

test('parseContent가 table 카드의 행에 기본값을 채운다', () => {
  const raw = JSON.stringify({
    caption: 'c', threadsPosts: ['t'],
    cards: [{ template: 'table', title: '순위', rows: [{ label: '강남구', value: '10건' }] }],
  });
  const c = parseContent(raw);
  assert.equal(c.cards[0].rows[0].rank, 1);
  assert.equal(c.cards[0].rows[0].delta, '');
});

test('parseContent가 table 카드에 rows가 없으면 빈 배열로 채운다', () => {
  const raw = JSON.stringify({ caption: 'c', threadsPosts: ['t'], cards: [{ template: 'table', title: '순위' }] });
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
  assert.ok(p.includes('threadsPosts'));
});

test('parseStoryContent가 role을 정규화하고 잘못된 값은 cause로 보정한다', () => {
  const raw = JSON.stringify({
    caption: 'c', threadsPosts: ['t'],
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
    caption: 'c', threadsPosts: ['t'],
    cards: [{ template: 'text', role: 'summary', title: '요약', body: '본문' }],
  });
  const c = await generateStoryDraft([{ type: 'manual', title: 't', summary: '', data: null }], async () => raw);
  assert.equal(c.cards[0].role, 'summary');
});

test('parseStoryContent가 steps/conclusion을 정규화한다', () => {
  const raw = JSON.stringify({
    caption: 'c', threadsPosts: ['t'],
    cards: [{ template: 'text', role: 'cause', title: '원인', body: '본문', steps: ['중동 긴장', '유가 상승', '', '인플레 우려'], conclusion: '주식시장 하락' }],
  });
  const c = parseStoryContent(raw);
  assert.deepEqual(c.cards[0].steps, ['중동 긴장', '유가 상승', '인플레 우려']);
  assert.equal(c.cards[0].conclusion, '주식시장 하락');
});

test('parseStoryContent는 steps가 없으면 conclusion도 빈 문자열로 만든다', () => {
  const raw = JSON.stringify({
    caption: 'c', threadsPosts: ['t'],
    cards: [{ template: 'text', role: 'summary', title: '요약', body: '본문', conclusion: '유령 결론' }],
  });
  const c = parseStoryContent(raw);
  assert.deepEqual(c.cards[0].steps, []);
  assert.equal(c.cards[0].conclusion, '');
});

test('parseStoryContent가 stats를 정확히 2개일 때만 채운다', () => {
  const raw1 = JSON.stringify({
    caption: 'c', threadsPosts: ['t'],
    cards: [{ template: 'text', role: 'marketImpact', title: '매도', body: '본문', stats: [{ label: '외국인', value: '-4,147억' }, { label: '기관', value: '-4,415억' }] }],
  });
  const c1 = parseStoryContent(raw1);
  assert.deepEqual(c1.cards[0].stats, [{ label: '외국인', value: '-4,147억' }, { label: '기관', value: '-4,415억' }]);

  const raw2 = JSON.stringify({
    caption: 'c', threadsPosts: ['t'],
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --import ./tests/setup.mjs --test tests/content.test.js`
Expected: FAIL — `threadsPosts` 관련 assertion들이 현재 `threadsText` 기반 구현과 맞지 않아 여러 건 실패(특히 "threadsPosts가 없거나..." 테스트는 현재 코드에서 throw하지 않아 실패, "buildPrompt에 threadsPosts 지시문..." 은 현재 프롬프트에 해당 문구가 없어 실패).

- [ ] **Step 3: 구현 — `src/generator/content.js`의 `buildPrompt` 규칙 부분(현재 42-50번째 줄) 교체**

`- caption: 인스타 캐프션 300자 이내 + 해시태그 8~12개.` 줄과 `- threadsText: ...` 줄, 그리고 출력 형식 줄을 아래로 교체:

```js
- caption: 100만 팔로워를 가진 인플루언서가 팔로워에게 직접 꿀팁을 알려주듯, 첫 문장부터 눈길을 끄는 후킹(질문·놀라운 숫자·공감 포인트)으로 시작해 친근하고 임팩트 있게 쓴다(이모지 적절히 포함). 다만 투자 조언·과장된 단정 표현은 쓰지 않는다(꿀팁이지 투자 권유가 아니다). 300자 이내 + 해시태그 8~12개.
- threadsPosts: 인플루언서가 팔로워에게 말 걸듯 반말로 캐주얼하고 임팩트 있게 쓴 연속된 글 2~4개(소스가 얇으면 2개, 풍부하면 4개까지 — 억지로 늘리지 않는다). 1번째 글은 후킹(질문·놀라운 숫자·공감 포인트)으로 시작한다. 각 글은 200자 이내. 투자 조언은 하지 않는다. 마지막 글에만 "자세한 카드뉴스는 인스타그램에서 확인" 유도 문구를 넣는다(계정명 없이).

출력 형식(JSON만, 다른 텍스트 금지):
{"caption":"...","cards":[...],"threadsPosts":["...","...","..."]}
```

전체 함수는 다음과 같은 모습이 된다(수정 후 `buildPrompt` 전체):

```js
export function buildPrompt(sources, cardTypes = null) {
  const srcText = sources.map((s, i) =>
    `[소스${i + 1}] (${s.type}) ${s.title}\n${s.summary || ''}\n${s.data ? 'data: ' + JSON.stringify(s.data) : ''}`
  ).join('\n\n');

  const cardInstruction = (cardTypes && cardTypes.length)
    ? `cards는 최대 ${cardTypes.length}장이며, 순서와 타입은 다음과 같다: ${cardTypes.join(' → ')}. 단, 소스 내용이 부족해 같은 내용을 다른 표현으로 반복하게 될 것 같으면 뒤쪽 카드부터 생략해 개수를 줄인다(무리하게 채우지 않는다).
각 카드의 출력 형식:
${cardTypes.map((t, i) => `${i + 1}번 카드 (${t}): ${TYPE_SPEC[t] || TYPE_SPEC.text}`).join('\n')}`
    : `cards는 내용에 필요한 만큼만 만든다(보통 1~4장, 정보가 짧으면 1장도 충분하다 — 억지로 늘리지 않는다). 수치·순위 데이터가 있으면 "data"나 "table"을, 추이가 있으면 "chart"를 적극 사용한다. 표지("cover")는 선택이며 본문 카드 하나로 헤드라인+표까지 다 담아도 된다.`;

  return `너는 10년 이상 경력의 한국 경제·부동산 데이터 카드뉴스 에디터다. 실제 업계 계정(부동산 정보 카드뉴스)처럼 정보 밀도가 높고 한눈에 읽히는 콘텐츠를 만든다.

디자인 원칙(반드시 지킬 것):
- 장식적인 문장이나 감상 없이, 숫자·표·핵심 사실 위주로 압축한다.
- 헤드라인은 짧고 강하게. 가능하면 구체적 숫자를 헤드라인에 넣는다(예: "코스피 7천 붕괴" O, "증시가 흔들리고 있습니다" X).
- 소스에 있는 실제 수치는 반올림하지 말고 그대로 인용하고, 인용했다면 source 필드에 출처를 짧게 적는다(예: "* 출처: 연합뉴스"). 출처가 불분명하면 source는 빈 문자열로 둔다.
- 비교·순위·항목이 3개 이상이면 "table"에 columns를 채워 표로 정리한다. 단순 강조 수치 하나면 "data"를 쓴다.
- tag는 이 카드의 성격을 한 단어로 압축한 라벨이다(예: "긴급속보", "청약정보", "금리동향"). 애매하면 null로 둔다.
- 절대 과장하거나 확정되지 않은 걸 단정하지 않는다. 정보 전달 톤. 투자 조언·매수/매도 권유 금지.

아래 소스를 바탕으로 카드뉴스 구성안을 JSON으로만 출력하라.
우리 브랜드명은 "${config.brandName}"이다. 다른 인스타그램 계정명(@아이디)은 절대 언급하지 마라.

${srcText}

규칙:
- ${cardInstruction}
- title은 20자 이내. 쉬운 한국어.
- chart/table 타입인데 소스에 활용할 수치·순위 데이터가 없으면 labels/values 또는 columns/rows를 빈 배열로 둔다.
- caption: 100만 팔로워를 가진 인플루언서가 팔로워에게 직접 꿀팁을 알려주듯, 첫 문장부터 눈길을 끄는 후킹(질문·놀라운 숫자·공감 포인트)으로 시작해 친근하고 임팩트 있게 쓴다(이모지 적절히 포함). 다만 투자 조언·과장된 단정 표현은 쓰지 않는다(꿀팁이지 투자 권유가 아니다). 300자 이내 + 해시태그 8~12개.
- threadsPosts: 인플루언서가 팔로워에게 말 걸듯 반말로 캐주얼하고 임팩트 있게 쓴 연속된 글 2~4개(소스가 얇으면 2개, 풍부하면 4개까지 — 억지로 늘리지 않는다). 1번째 글은 후킹(질문·놀라운 숫자·공감 포인트)으로 시작한다. 각 글은 200자 이내. 투자 조언은 하지 않는다. 마지막 글에만 "자세한 카드뉴스는 인스타그램에서 확인" 유도 문구를 넣는다(계정명 없이).

출력 형식(JSON만, 다른 텍스트 금지):
{"caption":"...","cards":[...],"threadsPosts":["...","...","..."]}`;
}
```

- [ ] **Step 4: 구현 — `buildStoryPrompt`의 출력 섹션(현재 159-171번째 줄, `## 콘텐츠 원칙` ~ 끝) 교체**

```js
## 콘텐츠 원칙
- 기사를 그대로 복사하지 않는다. 팩트와 의견을 명확히 구분한다.
- 추측은 반드시 "가능성이 있다"는 식으로 표현한다. 과장하거나 클릭 유도용 허위 문구를 쓰지 않는다.
- 숫자는 소스와 동일하게 사용한다(반올림·창작 금지).
- 복잡한 경제 용어는 쉽게 풀어 설명한다. 투자 조언·매수매도 권유 금지.
- 우리 브랜드명은 "${config.brandName}"이다. 다른 인스타그램 계정명은 언급하지 않는다.

## 출력
- caption: 100만 팔로워를 가진 인플루언서가 팔로워에게 직접 꿀팁을 알려주듯, 첫 문장부터 눈길을 끄는 후킹(질문·놀라운 숫자·공감 포인트)으로 시작해 친근하고 임팩트 있게 쓴다(이모지 적절히 포함). 다만 투자 조언·과장된 단정 표현은 쓰지 않는다(꿀팁이지 투자 권유가 아니다). 300자 이내 + 해시태그 8~12개.
- threadsPosts: 인플루언서가 팔로워에게 말 걸듯 반말로 캐주얼하고 임팩트 있게 쓴 연속된 글 2~4개(소스가 얇으면 2개, 풍부하면 4개까지 — 억지로 늘리지 않는다). 1번째 글은 후킹(질문·놀라운 숫자·공감 포인트)으로 시작한다. 각 글은 200자 이내. 투자 조언은 하지 않는다. 마지막 글에만 "자세한 카드뉴스는 인스타그램에서 확인" 유도 문구를 넣는다(계정명 없이).

출력 형식(JSON만, 다른 텍스트 금지):
{"caption":"...","cards":[...],"threadsPosts":["...","...","..."]}`;
}
```

(이 블록은 `buildStoryPrompt` 함수의 끝부분이다 — 마지막 백틱과 닫는 중괄호까지 그대로 포함해서 교체할 것.)

- [ ] **Step 5: 구현 — `parseContent`의 필수 필드 검증·정규화(현재 58-64번째 줄) 교체**

```js
export function parseContent(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = (m ? m[1] : text).trim();
  const obj = JSON.parse(jsonStr);
  const threadsPosts = Array.isArray(obj.threadsPosts)
    ? obj.threadsPosts.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 4)
    : [];
  if (!obj.caption || !Array.isArray(obj.cards) || obj.cards.length < 1 || threadsPosts.length === 0) {
    throw new Error('생성 결과에 caption/cards/threadsPosts가 없습니다');
  }
  obj.threadsPosts = threadsPosts;
```

(이 뒤로 이어지는 `for (const c of obj.cards) { ... }` 루프와 `return obj;`는 그대로 둔다.)

- [ ] **Step 6: 통과 확인**

Run: `node --import ./tests/setup.mjs --test tests/content.test.js`
Expected: PASS (전체 테스트)

- [ ] **Step 7: 커밋**

```bash
git add src/generator/content.js tests/content.test.js
git commit -m "feat(content): Threads를 threadsPosts 배열(반말 쓰레드)로, 캡션을 인플루언서 톤으로 변경"
```

---

### Task 2: threads.js — 답글 체인 발행

**Files:**
- Modify: `src/publisher/threads.js`
- Modify: `tests/threads.test.js`

**Interfaces:**
- Produces: `publishToThreads({ text, imageUrl }, fetchFn, creds): Promise<{ id, permalink }>` — `text`가 `string`이면 기존과 동일한 단일 발행(반환 형태·URL 파라미터 순서까지 완전 동일), `text`가 `string[]`이면 첫 글(이미지 포함)을 루트로 발행 후 나머지를 `reply_to_id`로 답글 체인 발행하고, 루트 글의 `{id, permalink}`를 반환한다.
- Consumes: 없음(외부 Threads Graph API만 호출).

- [ ] **Step 1: 실패 테스트 작성 — `tests/threads.test.js` 맨 아래에 추가**

기존 2개 테스트(문자열 입력)는 그대로 두고, 파일 끝에 추가:

```js

test('배열 입력 시 실제 쓰레드로 답글 체인을 발행한다', async () => {
  const calls = [];
  let n = 0;
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes('threads_publish')) { n++; return { ok: true, json: async () => ({ id: `pub${n}` }) }; }
    if (url.includes('fields=permalink')) return { ok: true, json: async () => ({ permalink: `https://threads.net/@u/post/${n}` }) };
    return { ok: true, json: async () => ({ id: `container${n}` }) };
  };
  const r = await publishToThreads(
    { text: ['1번째 글이야', '2번째 글', '3번째 글'], imageUrl: 'https://a/1.png' },
    fakeFetch, { threadsUserId: 'U', threadsAccessToken: 'T' },
  );
  assert.ok(r.permalink.includes('threads'));
  assert.equal(r.id, 'pub1');

  const containerCalls = calls.filter((u) => u.includes('/threads?') && !u.includes('threads_publish'));
  assert.equal(containerCalls.length, 3);
  assert.ok(containerCalls[0].includes('media_type=IMAGE'));
  assert.ok(!containerCalls[0].includes('reply_to_id'));
  assert.ok(containerCalls[1].includes('media_type=TEXT'));
  assert.ok(containerCalls[1].includes('reply_to_id=pub1'));
  assert.ok(!containerCalls[1].includes('image_url'));
  assert.ok(containerCalls[2].includes('reply_to_id=pub2'));
});

test('빈 문자열이 섞인 배열은 걸러내고 발행한다', async () => {
  const calls = [];
  let n = 0;
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes('threads_publish')) { n++; return { ok: true, json: async () => ({ id: `pub${n}` }) }; }
    if (url.includes('fields=permalink')) return { ok: true, json: async () => ({ permalink: 'https://threads.net/@u/post/z' }) };
    return { ok: true, json: async () => ({ id: `container${n}` }) };
  };
  await publishToThreads(
    { text: ['첫 글', '', '  ', '둘째 글'] },
    fakeFetch, { threadsUserId: 'U', threadsAccessToken: 'T' },
  );
  const containerCalls = calls.filter((u) => u.includes('/threads?') && !u.includes('threads_publish'));
  assert.equal(containerCalls.length, 2);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import ./tests/setup.mjs --test tests/threads.test.js`
Expected: FAIL — `publishToThreads`가 배열 입력을 처리하지 못해 `text`를 그대로 `encodeURIComponent`에 넘겨 이상한 URL을 만들거나 어서션이 실패한다.

- [ ] **Step 3: 구현 — `src/publisher/threads.js` 전체 교체**

```js
import { config } from '../config.js';

const T = 'https://graph.threads.net/v1.0';

// 컨테이너 생성 → 발행 → permalink 조회 3단계. replyToId가 있으면 그 글에 답글로 붙는다.
// 답글에는 이미지를 붙이지 않는다는 전제로, imageUrl은 루트 글 호출 때만 넘어온다.
async function publishOnePost({ text, imageUrl, replyToId, threadsUserId, threadsAccessToken, fetchFn }) {
  const enc = encodeURIComponent;
  const parts = imageUrl
    ? [`media_type=IMAGE`, `image_url=${enc(imageUrl)}`, `text=${enc(text)}`]
    : [`media_type=TEXT`, `text=${enc(text)}`];
  if (replyToId) parts.push(`reply_to_id=${enc(replyToId)}`);
  const mediaParams = parts.join('&');

  let res = await fetchFn(`${T}/${threadsUserId}/threads?${mediaParams}&access_token=${threadsAccessToken}`, { method: 'POST' });
  let j = await res.json();
  if (!res.ok || j.error) throw new Error(`[threads:container] ${j.error?.message || res.status}`);

  res = await fetchFn(`${T}/${threadsUserId}/threads_publish?creation_id=${j.id}&access_token=${threadsAccessToken}`, { method: 'POST' });
  const pub = await res.json();
  if (!res.ok || pub.error) throw new Error(`[threads:publish] ${pub.error?.message || res.status}`);

  const permRes = await fetchFn(`${T}/${pub.id}?fields=permalink&access_token=${threadsAccessToken}`);
  const perm = await permRes.json();
  return { id: pub.id, permalink: perm.permalink || null };
}

export async function publishToThreads({ text, imageUrl = null }, fetchFn = fetch, creds = config.meta) {
  const { threadsUserId, threadsAccessToken } = creds;
  if (!threadsUserId || !threadsAccessToken) throw new Error('THREADS_USER_ID / THREADS_ACCESS_TOKEN을 .env에 설정하세요');

  if (!Array.isArray(text)) {
    return publishOnePost({ text, imageUrl, replyToId: null, threadsUserId, threadsAccessToken, fetchFn });
  }

  // 배열이면 실제 '쓰레드'로 발행한다: 첫 글만 이미지를 붙이고, 나머지는 이전 글에
  // reply_to_id로 답글을 이어 붙인다. 체인 중간에 실패하면 예외를 던진다(이미 발행된
  // 글은 남지만 이 함수는 부분 성공을 별도로 알리지 않는다 — 호출부가 기존 발행 실패와
  // 동일하게 처리한다).
  const posts = text.map(String).map((s) => s.trim()).filter(Boolean);
  const root = await publishOnePost({ text: posts[0], imageUrl, replyToId: null, threadsUserId, threadsAccessToken, fetchFn });
  let lastId = root.id;
  for (const post of posts.slice(1)) {
    const reply = await publishOnePost({ text: post, imageUrl: null, replyToId: lastId, threadsUserId, threadsAccessToken, fetchFn });
    lastId = reply.id;
  }
  return root;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import ./tests/setup.mjs --test tests/threads.test.js`
Expected: PASS (기존 2개 + 신규 2개, 총 4개)

- [ ] **Step 5: 커밋**

```bash
git add src/publisher/threads.js tests/threads.test.js
git commit -m "feat(threads): 배열 입력 시 reply_to_id로 답글 체인 발행"
```

---

### Task 3: server.js — 발행 라우트에서 threadsPosts 우선 사용

**Files:**
- Modify: `src/web/server.js:252`
- Modify: `tests/server.test.js`

**Interfaces:**
- Consumes: `publishThreads`(Task 2, 이미 DI로 주입되어 있음), `d.content.threadsPosts`/`d.content.threadsText`(Task 1이 만드는 새 필드 / 과거 필드).
- Produces: 없음(라우트 동작 변경만).

- [ ] **Step 1: 실패 테스트 작성 — `tests/server.test.js` 맨 아래에 추가**

```js

test('publish — threadsPosts 배열이 있으면 배열 그대로 publishThreads에 전달한다', async () => {
  const dbG = openDb(':memory:');
  let receivedText = null;
  const appG = createServer(dbG, {
    generateContent: async () => ({
      caption: 'c',
      cards: [{ template: 'cover', title: 't', body: '' }],
      threadsPosts: ['첫 글', '둘째 글'],
    }),
    generateCardImage: async () => null,
    renderCards: async (draftId, cards) => cards.map((_, i) => `data/images/${draftId}/card-${i + 1}.png`),
    uploadImages: async (paths) => paths.map((_, i) => `https://cdn/x${i}.png`),
    publishInstagram: async () => ({ id: 'ig1', permalink: 'https://instagram.com/p/x' }),
    publishThreads: async ({ text }) => { receivedText = text; return { id: 'th1', permalink: 'https://threads.net/p/x' }; },
  });
  const srvG = appG.listen(0);
  try {
    const baseG = `http://127.0.0.1:${srvG.address().port}`;
    const sid = dbG.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(baseG + '/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sid] }) });
    const draft = await r.json();
    r = await fetch(baseG + `/api/drafts/${draft.id}/images`, { method: 'POST' });
    await r.json();
    r = await fetch(baseG + `/api/drafts/${draft.id}/publish`, { method: 'POST' });
    assert.equal(r.status, 200);
    assert.deepEqual(receivedText, ['첫 글', '둘째 글']);
  } finally { srvG.close(); }
});

test('publish — threadsPosts 없으면 기존 threadsText 문자열을 그대로 전달한다(하위 호환)', async () => {
  const dbH = openDb(':memory:');
  let receivedText = null;
  const appH = createServer(dbH, {
    generateContent: async () => ({
      caption: 'c',
      cards: [{ template: 'cover', title: 't', body: '' }],
      threadsText: '레거시 글',
    }),
    generateCardImage: async () => null,
    renderCards: async (draftId, cards) => cards.map((_, i) => `data/images/${draftId}/card-${i + 1}.png`),
    uploadImages: async (paths) => paths.map((_, i) => `https://cdn/x${i}.png`),
    publishInstagram: async () => ({ id: 'ig1', permalink: 'https://instagram.com/p/x' }),
    publishThreads: async ({ text }) => { receivedText = text; return { id: 'th1', permalink: 'https://threads.net/p/x' }; },
  });
  const srvH = appH.listen(0);
  try {
    const baseH = `http://127.0.0.1:${srvH.address().port}`;
    const sid = dbH.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(baseH + '/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sid] }) });
    const draft = await r.json();
    r = await fetch(baseH + `/api/drafts/${draft.id}/images`, { method: 'POST' });
    await r.json();
    r = await fetch(baseH + `/api/drafts/${draft.id}/publish`, { method: 'POST' });
    assert.equal(r.status, 200);
    assert.equal(receivedText, '레거시 글');
  } finally { srvH.close(); }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import ./tests/setup.mjs --test tests/server.test.js`
Expected: FAIL — 현재 라우트는 항상 `d.content.threadsText`만 넘기므로 첫 번째 신규 테스트가 `receivedText`를 `undefined`로 받아 실패한다.

- [ ] **Step 3: 구현 — `src/web/server.js:252` 교체**

```js
    if (!alreadyThreads) {
      try {
        const threadsInput = d.content.threadsPosts?.length ? d.content.threadsPosts : d.content.threadsText;
        result.threads = await publishThreads({ text: threadsInput, imageUrl: urls[0] });
      }
      catch (e) { result.threads = { error: e.message }; }
    }
```

(원래 코드 `if (!alreadyThreads) { try { result.threads = await publishThreads({ text: d.content.threadsText, imageUrl: urls[0] }); } catch (e) { result.threads = { error: e.message }; } }` 전체를 위 블록으로 교체한다.)

- [ ] **Step 4: 통과 확인**

Run: `node --import ./tests/setup.mjs --test tests/server.test.js`
Expected: PASS (기존 + 신규 2개)

- [ ] **Step 5: 전체 테스트**

Run: `npm test`
Expected: PASS (전부)

- [ ] **Step 6: 커밋**

```bash
git add src/web/server.js tests/server.test.js
git commit -m "feat(threads): 발행 라우트가 threadsPosts를 우선 사용하도록 변경(threadsText 하위 호환)"
```

---

### Task 4: 대시보드 UI — Threads 글 4칸 편집

**Files:**
- Modify: `src/web/public/index.html:73-74`
- Modify: `src/web/public/app.js:380`, `app.js:437`
- Modify: `src/web/public/style.css`

**Interfaces:**
- Consumes: `content.threadsPosts`(Task 1)/`content.threadsText`(과거 초안).

- [ ] **Step 1: index.html — Threads 글 textarea 1개를 4칸으로 교체**

`src/web/public/index.html`의 다음 두 줄을:
```html
      <h2>Threads 글</h2>
      <textarea id="ed-threads" rows="3"></textarea>
```
아래로 교체:
```html
      <h2>Threads 글 (쓰레드, 최대 4개)</h2>
      <textarea id="ed-thread-1" rows="2" placeholder="1번째 글(후킹) — 반말"></textarea>
      <textarea id="ed-thread-2" rows="2" placeholder="2번째 글"></textarea>
      <textarea id="ed-thread-3" rows="2" placeholder="3번째 글"></textarea>
      <textarea id="ed-thread-4" rows="2" placeholder="4번째 글(마지막에만 유도 문구)"></textarea>
```

- [ ] **Step 2: app.js — renderDraftDetail()에서 4칸 채우기**

`src/web/public/app.js`의 `$('#ed-threads').value = d.content?.threadsText || '';`(현재 380번째 줄)를 아래로 교체:

```js
  const threadsPosts = d.content?.threadsPosts?.length ? d.content.threadsPosts : (d.content?.threadsText ? [d.content.threadsText] : []);
  ['#ed-thread-1', '#ed-thread-2', '#ed-thread-3', '#ed-thread-4'].forEach((sel, i) => { $(sel).value = threadsPosts[i] || ''; });
```

- [ ] **Step 3: app.js — collectEditedContent()에서 4칸을 배열로 모으기**

`src/web/public/app.js`의 `collectEditedContent()`(현재 433-441번째 줄) 안의 `threadsText: $('#ed-threads').value,` 줄을 아래로 교체:

```js
    threadsPosts: ['#ed-thread-1', '#ed-thread-2', '#ed-thread-3', '#ed-thread-4'].map((sel) => $(sel).value.trim()).filter(Boolean),
```

- [ ] **Step 4: style.css — 4칸 여백**

`src/web/public/style.css`의 `#ed-blog-title, #ed-blog-body { margin-top: 8px; }` 규칙 아래에 추가:
```css
#ed-thread-1, #ed-thread-2, #ed-thread-3, #ed-thread-4 { margin-top: 6px; }
```

- [ ] **Step 5: 수동 확인**

```bash
npm test
```
Expected: 기존 백엔드 테스트 전부 PASS(이 태스크는 백엔드를 건드리지 않으므로 회귀 없어야 함).

`npm start` 후 대시보드에서 초안 상세로 이동해:
- "Threads 글 (쓰레드, 최대 4개)" 아래 4개의 textarea가 보인다.
- 과거 초안(threadsText만 있는 초안이 있다면)을 열면 1번째 칸에만 값이 채워진다.
- 새로 "글 재생성"한 초안을 열면 여러 칸에 값이 채워질 수 있다(Gemini가 실제로 몇 개를 반환했는지에 따라 다름).
- 저장(`💾 저장`) 후 다시 열어도 값이 유지된다.

- [ ] **Step 6: 커밋**

```bash
git add src/web/public/index.html src/web/public/app.js src/web/public/style.css
git commit -m "feat(threads): 대시보드 Threads 글 편집을 고정 4칸으로 변경"
```

---

## Self-Review

- **Spec 커버리지:** threadsPosts 생성·톤(반말/후킹/마지막 글 유도문구)·검증=Task 1, 답글 체인 발행(reply_to_id, 이미지는 루트만, 문자열 입력 하위 호환)=Task 2, 서버 라우트 threadsPosts 우선/threadsText 폴백=Task 3, UI 4칸 편집=Task 4. 캡션 톤 변경도 Task 1에 포함. 범위 밖(동적 추가/삭제 UI, 캡션 반말화, DB 마이그레이션)은 계획에 포함하지 않음. ✅
- **Placeholder 스캔:** 모든 스텝에 실제 코드 포함. "TBD"/"TODO" 없음. ✅
- **타입 일관성:** `parseContent`가 반환하는 `threadsPosts: string[]`(Task 1) → `generateDraftContent`/`generateStoryDraft`가 그대로 반환 → 서버 라우트가 `d.content.threadsPosts`로 읽음(Task 3) → `publishToThreads({text: string[]})`(Task 2)가 그 배열을 그대로 소비 → UI가 같은 필드명으로 읽고 씀(Task 4). 네 태스크에서 필드명 `threadsPosts`가 정확히 일치. `publishToThreads`의 문자열 입력 반환 형태 `{id, permalink}`가 배열 입력 시에도(루트 글 기준) 동일하게 유지되어 서버 라우트의 `result.threads?.permalink` 읽기 코드가 변경 없이 동작. ✅
