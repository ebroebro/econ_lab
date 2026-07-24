# 청약 정보 수집 + 전용 카드 타입 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공공데이터포털 "한국부동산원_청약홈_APT 분양정보" API로 아파트 청약 공고를 자동 수집해 소스함에 쌓고(기존 뉴스/증시/부동산과 동일한 cron 패턴), 이를 카드뉴스로 만들 때 단지명·지역·총세대수·접수기간·당첨자발표일이 나오는 전용 카드 타입(`subscription`)으로 렌더링한다.

**Architecture:** 새 수집기(`src/collectors/subscription.js`)가 odcloud REST API를 직접 호출해 `type: 'subscription'` 소스로 저장하고(공고 고유 URL로 중복 방지), 기존 cron에 매일 1회 등록한다. `content.js`에 `subscription` 카드 타입 스펙·파싱을 추가하고, HTML 폴백 렌더러(`templates.js`)와 AI 이미지 프롬프트(`aiCard.js`) 양쪽에 이 타입의 렌더링 로직을 추가한다. 대시보드에 전용 카드 편집 UI와 소스 배지를 추가한다.

**Tech Stack:** 기존 프로젝트(Node ESM, Express 5, node-cron, better-sqlite3, node:test, vanilla JS 프런트엔드). 새 의존성 없음(내장 `fetch` 사용).

## Global Constraints

- `DATA_GO_KR_API_KEY` 환경변수가 없으면 수집을 건너뛰고 0을 반환한다(기존 `realestate.js`의 `ecosApiKey` 없을 때 관례와 동일).
- 새 DB 스키마/컬럼을 추가하지 않는다 — 중복 방지는 기존 `db.insertSource`의 `url` 유니크 인덱스를 그대로 활용한다.
- 청약 공고의 `모집공고홈페이지주소`(공고마다 고유한 실제 URL)를 소스의 `url`로 그대로 사용해 중복을 방지한다.
- 새 공고 수집 시 초안(카드뉴스) 자동 생성은 하지 않는다 — 수집만 자동, 초안 생성은 기존과 동일하게 사용자가 대시보드에서 수동으로 트리거한다.
- API 응답의 값이 없는 필드는 `null`로 온다 — 수집기는 이를 안전한 기본값(빈 문자열/0)으로 정규화해서 저장한다.
- Node ESM(`import`), 파일 상단 한글 주석은 "왜"를 설명(기존 코드 스타일 준수).
- 프런트엔드(`src/web/public/*`)는 자동 테스트 스위트가 없다(기존 관례) — UI 태스크는 수동/curl 기반 검증으로 확인한다.

---

## File Structure

- **Create `src/collectors/subscription.js`** — odcloud API 호출 + `subscription` 소스 저장.
- **Modify `src/collectors/agent.js`** — `runAllCollectors`/`startAgent`에 `collectSubscriptions` 등록(매일 08:30).
- **Modify `src/config.js`** — `dataGoKrApiKey` 추가.
- **Modify `src/generator/content.js`** — `VALID_TEMPLATES`에 `subscription` 추가, 전용 필드 스펙, 디자인 원칙에 사용 안내, `parseContent` 정규화 분기.
- **Modify `src/renderer/templates.js`** — `subscription` 카드 HTML 렌더링 분기(새 CSS 없음, 기존 `big-stat`/`mini-rows` 재사용).
- **Modify `src/renderer/aiCard.js`** — `subscription` 카드 AI 이미지 프롬프트 분기.
- **Modify `src/web/public/index.html`** — 소스함 유형 필터에 "청약" 옵션 추가.
- **Modify `src/web/public/app.js`** — `TYPE_LABEL`/`TEMPLATE_LABEL`에 `subscription` 추가, `buildCardEditor`에 전용 편집 UI 분기 추가.
- **Modify `src/web/public/style.css`** — `.badge.subscription` 색상 추가.
- **Tests:** `tests/subscription.test.js`(신규), `tests/content.test.js`, `tests/templates.test.js`, `tests/aiCard.test.js`.

---

### Task 1: subscription.js — 청약 공고 수집기

**Files:**
- Create: `src/collectors/subscription.js`
- Modify: `src/config.js`
- Modify: `src/collectors/agent.js`
- Modify: `.env.example`(이미 `DATA_GO_KR_API_KEY=` 항목이 있음 — 변경 불필요, 확인만)
- Test: `tests/subscription.test.js`

**Interfaces:**
- Produces: `collectSubscriptions(db, apiKey, fetchFn = fetch): Promise<number>` — 저장(또는 처리) 건수 반환. 실패 시 0.
- Consumes: `db.insertSource({type, title, url, summary, data})`(기존, `src/db.js`), `config.dataGoKrApiKey`(이 태스크에서 추가).

- [ ] **Step 1: config에 dataGoKrApiKey 추가**

`src/config.js`의 `ecosApiKey: process.env.ECOS_API_KEY || '',` 줄 바로 아래에 추가:
```js
  dataGoKrApiKey: process.env.DATA_GO_KR_API_KEY || '',
```

- [ ] **Step 2: 실패 테스트 작성**

`tests/subscription.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { collectSubscriptions } from '../src/collectors/subscription.js';

test('키 없으면 건너뛴다', async () => {
  const db = openDb(':memory:');
  assert.equal(await collectSubscriptions(db, ''), 0);
});

test('청약 공고를 subscription 소스로 저장하고, 같은 공고 재수집 시 중복 저장하지 않는다', async () => {
  const db = openDb(':memory:');
  const item = {
    주택관리번호: 2025820017,
    주택명: '남양주왕숙 A-24블록 신혼희망타운(공공분양)(본청약)',
    공급지역명: '경기',
    공급규모: 390,
    청약접수시작일: '2025-12-08',
    청약접수종료일: '2025-12-12',
    당첨자발표일: '2025-12-24',
    모집공고일: '2025-11-27',
    모집공고홈페이지주소: 'https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancDetail.do?houseManageNo=2025820017&pblancNo=2025820017',
  };
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ data: [item], totalCount: 1, page: 1, perPage: 100, currentCount: 1, matchCount: 1 }),
  });

  await collectSubscriptions(db, 'KEY', fakeFetch);
  await collectSubscriptions(db, 'KEY', fakeFetch); // 재수집

  const rows = db.listSources({ type: 'subscription' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, item.주택명);
  assert.equal(rows[0].url, item.모집공고홈페이지주소);
  assert.match(rows[0].summary, /경기/);
  assert.match(rows[0].summary, /390/);
  assert.deepEqual(rows[0].data, {
    region: '경기', totalSupply: 390,
    receiptStart: '2025-12-08', receiptEnd: '2025-12-12',
    winnerDate: '2025-12-24', noticeDate: '2025-11-27',
  });
});

test('data 배열이 비어있으면 0건 반환', async () => {
  const db = openDb(':memory:');
  const fakeFetch = async () => ({ ok: true, json: async () => ({ data: [] }) });
  assert.equal(await collectSubscriptions(db, 'KEY', fakeFetch), 0);
});

test('API HTTP 오류 시 0건 반환하고 죽지 않는다', async () => {
  const db = openDb(':memory:');
  const fakeFetch = async () => ({ ok: false, status: 500 });
  assert.equal(await collectSubscriptions(db, 'KEY', fakeFetch), 0);
});

test('필드 값이 null이어도 안전한 기본값으로 정규화해 저장한다', async () => {
  const db = openDb(':memory:');
  const item = {
    주택관리번호: 111,
    주택명: '테스트단지',
    공급지역명: null,
    공급규모: null,
    청약접수시작일: null,
    청약접수종료일: null,
    당첨자발표일: null,
    모집공고일: null,
    모집공고홈페이지주소: 'https://example.com/111',
  };
  const fakeFetch = async () => ({ ok: true, json: async () => ({ data: [item] }) });
  await collectSubscriptions(db, 'KEY', fakeFetch);
  const rows = db.listSources({ type: 'subscription' });
  assert.deepEqual(rows[0].data, {
    region: '', totalSupply: 0, receiptStart: '', receiptEnd: '', winnerDate: '', noticeDate: '',
  });
});

test('모집공고홈페이지주소가 없는 항목은 건너뛴다', async () => {
  const db = openDb(':memory:');
  const fakeFetch = async () => ({ ok: true, json: async () => ({ data: [{ 주택명: '주소없음' }] }) });
  const saved = await collectSubscriptions(db, 'KEY', fakeFetch);
  assert.equal(saved, 0);
  assert.equal(db.listSources({ type: 'subscription' }).length, 0);
});
```

- [ ] **Step 3: 실패 확인**

Run: `node --import ./tests/setup.mjs --test tests/subscription.test.js`
Expected: FAIL — `Cannot find module '../src/collectors/subscription.js'`

- [ ] **Step 4: 구현**

`src/collectors/subscription.js`:
```js
// 공공데이터포털 "한국부동산원_청약홈_APT 분양정보" API. 별도 날짜 필터가 없어 매번 최신
// perPage(100)건을 가져오고, 공고마다 고유한 모집공고홈페이지주소를 url로 저장해
// db.insertSource의 url 유니크 인덱스로 중복 수집을 방지한다.
const ODCLOUD_URL = 'https://api.odcloud.kr/api/15101046/v1/uddi:14a46595-03dd-47d3-a418-d64e52820598';

export async function collectSubscriptions(db, apiKey, fetchFn = fetch) {
  if (!apiKey) return 0;
  try {
    const url = `${ODCLOUD_URL}?page=1&perPage=100&returnType=JSON&serviceKey=${encodeURIComponent(apiKey)}`;
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`odcloud HTTP ${res.status}`);
    const j = await res.json();
    const items = j?.data || [];

    let saved = 0;
    for (const item of items) {
      if (!item?.주택명 || !item?.모집공고홈페이지주소) continue;
      const region = item.공급지역명 || '';
      const totalSupply = Number(item.공급규모) || 0;
      const receiptStart = item.청약접수시작일 || '';
      const receiptEnd = item.청약접수종료일 || '';
      const winnerDate = item.당첨자발표일 || '';
      const noticeDate = item.모집공고일 || '';
      db.insertSource({
        type: 'subscription',
        title: item.주택명,
        url: item.모집공고홈페이지주소,
        summary: `${region} · 총 ${totalSupply}세대 · 접수 ${receiptStart}~${receiptEnd}`,
        data: { region, totalSupply, receiptStart, receiptEnd, winnerDate, noticeDate },
      });
      saved++;
    }
    return saved;
  } catch (e) {
    console.error('[collect:subscription] 실패:', e.message);
    return 0;
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `node --import ./tests/setup.mjs --test tests/subscription.test.js`
Expected: PASS (6 tests)

- [ ] **Step 6: agent.js에 등록**

`src/collectors/agent.js` 전체를 아래로 교체:
```js
import cron from 'node-cron';
import { collectNews } from './news.js';
import { collectStocks } from './stocks.js';
import { collectRealEstate } from './realestate.js';
import { collectSubscriptions } from './subscription.js';
import { config } from '../config.js';

export async function runAllCollectors(db) {
  const [news, stocks, realestate, subscription] = await Promise.all([
    collectNews(db),
    collectStocks(db),
    collectRealEstate(db, config.ecosApiKey),
    collectSubscriptions(db, config.dataGoKrApiKey),
  ]);
  console.log(`[agent] 수집 완료 — 뉴스 ${news}, 증시 ${stocks}, 부동산 ${realestate}, 청약 ${subscription}`);
  return { news, stocks, realestate, subscription };
}

export function startAgent(db) {
  cron.schedule('*/30 * * * *', () => collectNews(db));                                 // 뉴스: 30분마다
  cron.schedule('5 9-16 * * 1-5', () => collectStocks(db));                             // 증시: 평일 장중 매시 5분
  cron.schedule('0 8 * * *', () => collectRealEstate(db, config.ecosApiKey));           // 공공: 매일 08:00
  cron.schedule('30 8 * * *', () => collectSubscriptions(db, config.dataGoKrApiKey));   // 청약: 매일 08:30
  runAllCollectors(db).catch(e => console.error('[agent] 초기 수집 실패:', e.message));
  console.log('[agent] 백그라운드 수집 에이전트 시작');
}
```

- [ ] **Step 7: 전체 테스트**

Run: `npm test`
Expected: PASS (기존 전부 + 신규 6개)

- [ ] **Step 8: 커밋**

```bash
git add src/collectors/subscription.js src/collectors/agent.js src/config.js tests/subscription.test.js
git commit -m "feat(subscription): 청약홈 APT 분양정보 수집기 추가"
```

---

### Task 2: content.js — subscription 카드 타입 생성·파싱

**Files:**
- Modify: `src/generator/content.js`
- Modify: `tests/content.test.js`

**Interfaces:**
- Produces: `VALID_TEMPLATES`에 `'subscription'` 포함. `buildPrompt`/`buildStoryPrompt`가 출력하는 카드 JSON 중 `template:"subscription"`인 카드는 `region`/`totalSupply`/`receiptStart`/`receiptEnd`/`winnerDate` 필드를 갖는다. `parseContent`가 이 필드들을 문자열로 정규화한다(누락 시 빈 문자열).
- Consumes: 없음(Task 1과는 독립적 — 소스의 `type`이 `'subscription'`인 것과 카드의 `template`이 `'subscription'`인 것은 별개 개념이며, 이 태스크는 카드 template만 다룬다).

- [ ] **Step 1: 실패 테스트 작성**

`tests/content.test.js`의 `test('buildPrompt에 소스 제목과 규칙이 들어간다', ...)` 테스트 바로 아래에 추가:
```js

test('buildPrompt에 subscription 템플릿 사용 안내가 들어간다', () => {
  const p = buildPrompt([{ type: 'subscription', title: '청약 공고', summary: '경기 · 총 390세대', data: null }]);
  assert.ok(p.includes('subscription'));
  assert.ok(p.includes('청약'));
});

test('cardTypes에 subscription이 있으면 프롬프트에 전용 필드 스펙이 들어간다', () => {
  const p = buildPrompt(
    [{ type: 'subscription', title: '청약 공고', summary: '', data: null }],
    ['subscription'],
  );
  assert.ok(p.includes('"region"'));
  assert.ok(p.includes('"totalSupply"'));
  assert.ok(p.includes('"receiptStart"'));
  assert.ok(p.includes('"receiptEnd"'));
  assert.ok(p.includes('"winnerDate"'));
});
```

`tests/content.test.js`의 `test('parseContent가 table 카드에 rows가 없으면 빈 배열로 채운다', ...)` 테스트 바로 아래에 추가:
```js

test('parseContent가 subscription 카드 필드 기본값을 채운다', () => {
  const raw = JSON.stringify({
    caption: 'c', threadsPosts: ['t'],
    cards: [{ template: 'subscription', title: '남양주왕숙 A-24블록' }],
  });
  const c = parseContent(raw);
  assert.equal(c.cards[0].region, '');
  assert.equal(c.cards[0].totalSupply, '');
  assert.equal(c.cards[0].receiptStart, '');
  assert.equal(c.cards[0].receiptEnd, '');
  assert.equal(c.cards[0].winnerDate, '');
});

test('parseContent가 subscription 카드 필드 값을 그대로 유지한다', () => {
  const raw = JSON.stringify({
    caption: 'c', threadsPosts: ['t'],
    cards: [{
      template: 'subscription', title: '남양주왕숙 A-24블록', region: '경기', totalSupply: '390세대',
      receiptStart: '2025.12.08', receiptEnd: '2025.12.12', winnerDate: '2025.12.24',
    }],
  });
  const c = parseContent(raw);
  assert.equal(c.cards[0].region, '경기');
  assert.equal(c.cards[0].totalSupply, '390세대');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import ./tests/setup.mjs --test tests/content.test.js`
Expected: FAIL — `subscription`이 `VALID_TEMPLATES`에 없어 `text`로 강제 변환되고, 프롬프트에 관련 문구가 없어 여러 건 실패.

- [ ] **Step 3: 구현 — VALID_TEMPLATES와 TYPE_SPEC**

`src/generator/content.js`의 `const VALID_TEMPLATES = ['cover', 'text', 'data', 'chart', 'table', 'outro'];` 줄을 교체:
```js
const VALID_TEMPLATES = ['cover', 'text', 'data', 'chart', 'table', 'outro', 'subscription'];
```

`TYPE_SPEC` 객체의 `outro: '...',` 줄 바로 아래에 추가:
```js
  subscription: '{"template":"subscription","title":"(단지명, 20자 이내)","region":"(공급지역, 예: 서울 강남구)","totalSupply":"(총공급세대수, 예: 128세대)","receiptStart":"(청약접수 시작일, YYYY.MM.DD)","receiptEnd":"(청약접수 종료일, YYYY.MM.DD)","winnerDate":"(당첨자 발표일, YYYY.MM.DD)","tag":{"text":"청약정보","color":"blue"},"source":"(출처, 예: * 출처: 청약홈)"}',
```

- [ ] **Step 4: 구현 — 디자인 원칙에 사용 안내 추가**

`buildPrompt` 함수 안의 "디자인 원칙(반드시 지킬 것):" 목록 마지막 줄(`- 절대 과장하거나...`) 바로 아래에 추가:
```js
- 소스가 청약/분양 공고(단지명·접수기간·당첨자발표일 등 정보)라면 "subscription" 템플릿을 쓴다.
```

- [ ] **Step 5: 구현 — parseContent 정규화 분기**

`src/generator/content.js`의 `parseContent` 함수 안, `} else if (c.template === 'cover') { ... } else { c.body = c.body || ''; }` 부분을 아래로 교체:
```js
    } else if (c.template === 'cover') {
      c.body = c.body || '';
      c.meta = c.meta ? String(c.meta) : '';
    } else if (c.template === 'subscription') {
      c.region = c.region ? String(c.region) : '';
      c.totalSupply = c.totalSupply ? String(c.totalSupply) : '';
      c.receiptStart = c.receiptStart ? String(c.receiptStart) : '';
      c.receiptEnd = c.receiptEnd ? String(c.receiptEnd) : '';
      c.winnerDate = c.winnerDate ? String(c.winnerDate) : '';
    } else {
      c.body = c.body || '';
    }
```

- [ ] **Step 6: 통과 확인**

Run: `node --import ./tests/setup.mjs --test tests/content.test.js`
Expected: PASS (기존 + 신규 4개)

- [ ] **Step 7: 전체 테스트**

Run: `npm test`
Expected: PASS (전부)

- [ ] **Step 8: 커밋**

```bash
git add src/generator/content.js tests/content.test.js
git commit -m "feat(subscription): subscription 카드 타입 생성·파싱 추가"
```

---

### Task 3: 렌더러 — HTML 폴백 + AI 이미지 프롬프트

**Files:**
- Modify: `src/renderer/templates.js`
- Modify: `src/renderer/aiCard.js`
- Modify: `tests/templates.test.js`
- Modify: `tests/aiCard.test.js`

**Interfaces:**
- Consumes: `card.template === 'subscription'`이고 `region`/`totalSupply`/`receiptStart`/`receiptEnd`/`winnerDate` 필드를 가진 카드(Task 2가 정의).
- Produces: 없음(렌더링 함수 자체 시그니처는 변경 없음, 내부 분기만 추가).

- [ ] **Step 1: 실패 테스트 작성 — templates.test.js**

`tests/templates.test.js`의 `test('table 카드는 columns가 있으면...', ...)` 테스트 바로 아래에 추가:
```js

test('subscription 카드는 지역·총세대수·접수기간·발표일을 렌더링한다', () => {
  const html = renderCardHtml(
    {
      template: 'subscription', title: '남양주왕숙 A-24블록', region: '경기', totalSupply: '390세대',
      receiptStart: '2025.12.08', receiptEnd: '2025.12.12', winnerDate: '2025.12.24',
    },
    { seq: 1, total: 1 }
  );
  assert.ok(html.includes('남양주왕숙 A-24블록'));
  assert.ok(html.includes('경기'));
  assert.ok(html.includes('390세대'));
  assert.ok(html.includes('2025.12.08'));
  assert.ok(html.includes('2025.12.12'));
  assert.ok(html.includes('2025.12.24'));
});
```

- [ ] **Step 2: 실패 테스트 작성 — aiCard.test.js**

`tests/aiCard.test.js`의 `test('data 카드 프롬프트에 강조 숫자와 색상이 들어간다', ...)` 테스트 바로 아래에 추가:
```js

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
```

- [ ] **Step 3: 실패 확인**

Run: `node --import ./tests/setup.mjs --test tests/templates.test.js tests/aiCard.test.js`
Expected: FAIL — `subscription` 분기가 없어 두 함수 모두 기본(`text`) 분기를 타고, 위 필드들이 출력에 들어가지 않는다.

- [ ] **Step 4: 구현 — templates.js**

`src/renderer/templates.js`의 `renderCardHtml` 함수 안, `} else if (card.template === 'table') { inner = ...; } else { ... }` 부분에서 `table` 분기 바로 다음에 추가:
```js
  } else if (card.template === 'table') {
    inner = `${tag}${renderTableInner(card)}`;
  } else if (card.template === 'subscription') {
    const rows = [
      { label: '청약접수', value: `${card.receiptStart || ''} ~ ${card.receiptEnd || ''}` },
      { label: '당첨자발표', value: card.winnerDate || '' },
    ].map(r => `<div class="mini-row"><span class="label">${esc(r.label)}</span><span class="value">${esc(r.value)}</span></div>`).join('');
    inner = `${tag}<h2>${esc(card.title)}</h2>
      ${card.region ? `<div class="meta">${esc(card.region)}</div>` : ''}
      <div class="big-stat black">${esc(card.totalSupply || '')}</div>
      <div class="mini-rows">${rows}</div>`;
  } else {
```

(주의: 원래 `} else {` 바로 앞의 `renderTableInner` 줄까지는 그대로 두고, 그 다음에 새 `else if` 블록을 끼워 넣은 뒤 마지막 `} else {` 를 이어간다 — 위 코드가 이미 그 순서대로다.)

- [ ] **Step 5: 구현 — aiCard.js**

`src/renderer/aiCard.js`의 `buildCardImagePrompt` 함수 안, `data` 카드 분기(`} else if (card.template === 'data') { ... }`) 바로 다음, `cover` 분기 이전에 추가:
```js
  } else if (card.template === 'subscription') {
    parts.push(headlineLine(card.title));
    if (card.region) parts.push(`Small gray text below the headline: "${card.region}"`);
    parts.push(`Below that, a very large bold black number/text as the hero stat: "${card.totalSupply}". Exact digits, no rounding.`);
    const rows = `청약접수: ${card.receiptStart || ''} ~ ${card.receiptEnd || ''}, 당첨자발표: ${card.winnerDate || ''}`;
    parts.push(`Below that, a simple borderless list of label/value pairs: ${rows}.`);
  } else if (card.template === 'cover') {
```

(`data` 분기의 마지막 줄 바로 다음에 위 블록을 끼워 넣고, 기존 `} else if (card.template === 'cover') {` 로 이어지게 한다.)

- [ ] **Step 6: 통과 확인**

Run: `node --import ./tests/setup.mjs --test tests/templates.test.js tests/aiCard.test.js`
Expected: PASS (기존 + 신규 2개)

- [ ] **Step 7: 전체 테스트**

Run: `npm test`
Expected: PASS (전부)

- [ ] **Step 8: 커밋**

```bash
git add src/renderer/templates.js src/renderer/aiCard.js tests/templates.test.js tests/aiCard.test.js
git commit -m "feat(subscription): subscription 카드 HTML/AI 이미지 렌더링 추가"
```

---

### Task 4: 대시보드 UI — 소스 배지 + 카드 편집기

**Files:**
- Modify: `src/web/public/index.html`
- Modify: `src/web/public/app.js`
- Modify: `src/web/public/style.css`

**Interfaces:**
- Consumes: 소스의 `type === 'subscription'`(Task 1), 카드의 `template === 'subscription'` 및 그 필드들(Task 2).

- [ ] **Step 1: index.html — 유형 필터에 "청약" 옵션 추가**

`src/web/public/index.html`의 `<option value="manual">직접 입력</option>` 줄 바로 위에 추가:
```html
        <option value="subscription">청약</option>
```

- [ ] **Step 2: app.js — TYPE_LABEL/TEMPLATE_LABEL에 추가**

`src/web/public/app.js`의 `const TYPE_LABEL = { news: '뉴스', realestate: '부동산', stock: '증시', manual: '직접 입력' };` 줄을 교체:
```js
const TYPE_LABEL = { news: '뉴스', realestate: '부동산', stock: '증시', subscription: '청약', manual: '직접 입력' };
```

`const TEMPLATE_LABEL = { cover: '표지', text: '설명', data: '수치 강조', chart: '차트', table: '순위표', outro: '마무리', manual: '직접 업로드' };` 줄을 교체:
```js
const TEMPLATE_LABEL = { cover: '표지', text: '설명', data: '수치 강조', chart: '차트', table: '순위표', outro: '마무리', subscription: '청약정보', manual: '직접 업로드' };
```

- [ ] **Step 3: app.js — buildCardEditor에 subscription 편집 UI 추가**

`src/web/public/app.js`의 `buildCardEditor` 함수 안, `} else if (c.template === 'table') { ... renderTableRows(ed, c); } else { ... }` 부분에서 `table` 분기 바로 다음, 마지막 `else` 이전에 추가:
```js
  } else if (c.template === 'table') {
    ed.innerHTML = `
      <label>카드 ${i + 1} · ${TEMPLATE_LABEL[c.template]}</label>
      <input data-f="title" placeholder="제목">
      <div class="table-rows"></div>
      <button type="button" class="row-add" data-kind="table">+ 행 추가</button>`;
    ed.querySelector('[data-f="title"]').value = c.title || '';
    renderTableRows(ed, c);
  } else if (c.template === 'subscription') {
    ed.innerHTML = `
      <label>카드 ${i + 1} · ${TEMPLATE_LABEL[c.template]}</label>
      <input data-f="title" placeholder="단지명">
      <input data-f="region" placeholder="공급지역 (예: 서울 강남구)">
      <input data-f="totalSupply" placeholder="총공급세대수 (예: 128세대)">
      <input data-f="receiptStart" placeholder="청약접수 시작일">
      <input data-f="receiptEnd" placeholder="청약접수 종료일">
      <input data-f="winnerDate" placeholder="당첨자 발표일">`;
    ed.querySelector('[data-f="title"]').value = c.title || '';
    ed.querySelector('[data-f="region"]').value = c.region || '';
    ed.querySelector('[data-f="totalSupply"]').value = c.totalSupply || '';
    ed.querySelector('[data-f="receiptStart"]').value = c.receiptStart || '';
    ed.querySelector('[data-f="receiptEnd"]').value = c.receiptEnd || '';
    ed.querySelector('[data-f="winnerDate"]').value = c.winnerDate || '';
  } else {
```

(이 블록의 각 입력칸은 `data-f` 속성이 있어서, `buildCardEditor` 맨 아래에 이미 있는 공통 `ed.querySelectorAll('[data-f]').forEach(el => { el.addEventListener('input', () => { currentDraft.content.cards[i][el.dataset.f] = el.value; }); });` 리스너가 자동으로 편집 내용을 `currentDraft.content.cards[i]`에 반영한다 — 이 부분은 이미 있으니 수정하지 않는다.)

- [ ] **Step 4: style.css — 배지 색상 추가**

`src/web/public/style.css`의 `.badge.manual { background: #794bc433; color: #b78aff; }` 줄 바로 아래에 추가:
```css
.badge.subscription { background: #0d948833; color: #5eead4; }
```

- [ ] **Step 5: 수동 확인**

```bash
npm test
```
Expected: 기존 전체 테스트 PASS(이 태스크는 백엔드를 건드리지 않으므로 회귀 없어야 함).

`npm start` 후 대시보드에서:
- 소스함 유형 필터에 "청약" 옵션이 보인다.
- (청약 소스가 있다면) 소스 카드에 "청약" 배지(청록색)가 보인다.
- 카드 구성에서 "청약정보" 타입을 고를 수 있고, 초안 상세의 "카드 문구"에서 그 카드를 열면 단지명·공급지역·총공급세대수·접수시작·접수종료·발표일 6개 입력칸이 보이고 값을 수정할 수 있다.

- [ ] **Step 6: 커밋**

```bash
git add src/web/public/index.html src/web/public/app.js src/web/public/style.css
git commit -m "feat(subscription): 대시보드에 청약 소스 배지·카드 편집 UI 추가"
```

---

## Self-Review

- **Spec 커버리지:** API 호출·필드 매핑·중복방지·cron=Task 1, 카드 타입 생성·파싱·프롬프트 안내=Task 2, HTML/AI 렌더링=Task 3, UI(배지·필터·카드 편집기)=Task 4. 범위 밖(경쟁률 통계 API, 초안 자동생성)은 계획에 포함하지 않음. ✅
- **Placeholder 스캔:** 모든 스텝에 실제 코드 포함. "TBD"/"TODO" 없음. ✅
- **타입 일관성:** 소스 저장 시 `data: { region, totalSupply, receiptStart, receiptEnd, winnerDate, noticeDate }`(Task 1, 카드 필드 아님 — 소스 메타데이터)와 카드의 `region`/`totalSupply`/`receiptStart`/`receiptEnd`/`winnerDate`(Task 2, Gemini가 새로 생성하는 카드 필드)는 이름이 겹치지만 서로 다른 레이어(소스 vs 카드)이며 직접 연결되지 않는다는 점을 명확히 함 — Gemini가 소스의 `summary`(Task 1이 만든 "지역 · 총 N세대 · 접수 기간" 요약 문자열)를 읽고 카드 필드를 새로 채운다. Task 3의 `renderCardHtml`/`buildCardImagePrompt`가 소비하는 필드명(`region`/`totalSupply`/`receiptStart`/`receiptEnd`/`winnerDate`)이 Task 2의 TYPE_SPEC·parseContent 정규화 필드명과 정확히 일치. Task 4의 `buildCardEditor` `data-f` 속성명도 동일 필드명 사용. ✅
