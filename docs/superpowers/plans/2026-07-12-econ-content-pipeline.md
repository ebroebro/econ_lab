# 경제 콘텐츠 자동 발행 파이프라인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 경제 정보를 백그라운드에서 상시 수집하고, 대시보드에서 주제 선택 → Gemini 글 생성 → 검수 → 카드뉴스 이미지 생성 → 최종 검토 → 클릭 한 번으로 Instagram + Threads 자동 배포하는 로컬 앱.

**Architecture:** Node.js 단일 앱(ESM). Express 서버가 대시보드(정적 SPA)와 REST API를 제공하고, 같은 프로세스에서 node-cron 수집 에이전트가 상시 동작. SQLite(better-sqlite3)에 소스/초안/카드/발행 기록 저장. 카드 이미지는 HTML 템플릿 + Playwright 스크린샷(1080×1350), 배경 비주얼만 Gemini 이미지 생성. 발행은 Cloudinary 공개 URL → Instagram Graph API / Threads API.

**Tech Stack:** Node.js 20+, Express 4, better-sqlite3, node-cron, rss-parser, @google/genai, playwright, cloudinary, dotenv. 테스트는 내장 `node:test`.

## Global Constraints

- Node.js 20 이상, `"type": "module"` (ESM).
- Windows에서 동작해야 함 — 경로는 항상 `path.join`, 셸 의존 코드 금지.
- 카드 이미지 규격: 1080×1350 PNG (인스타 4:5 캐러셀).
- Gemini 모델명은 `.env`로 설정: `GEMINI_TEXT_MODEL`(기본 `gemini-2.5-flash`), `GEMINI_IMAGE_MODEL`(기본 `gemini-2.5-flash-image`).
- 생성 글에 투자 조언 금지 — 정보 전달 톤. 생성 프롬프트에 명시.
- 모든 API 키는 `.env`에서만 읽기, 코드·커밋에 키 금지. `data/`, `.env`는 `.gitignore`.
- 외부 API 실패는 앱을 죽이지 않는다: 수집기는 소스별 try/catch 후 로그, 발행기는 단계별 오류를 DB에 기록.
- 초안 상태 머신: `draft → text_approved → images_ready → published` (문자열 그대로 사용).

---

## 파일 구조

```
package.json
.env.example            # 필요한 키 목록 (실제 값 없음)
.gitignore
src/
  config.js             # .env 로드, 설정 상수
  db.js                 # better-sqlite3 연결 + 스키마 + CRUD
  collectors/
    news.js             # RSS 수집
    stocks.js           # 코스피/코스닥/환율
    realestate.js       # ECOS 기준금리 (+키 있으면 실거래가)
    agent.js            # node-cron 스케줄러 (백그라운드 수집 에이전트)
  generator/
    gemini.js           # Gemini 클라이언트 (텍스트/이미지 공용)
    content.js          # 초안 생성 (카드 문구·캐프션·Threads 글)
  renderer/
    templates.js        # 카드 HTML 템플릿 4종
    render.js           # Playwright 캡처 → PNG
    background.js       # Gemini 배경 생성 + 그라데이션 폴백
  publisher/
    hosting.js          # Cloudinary 업로드 → 공개 URL
    instagram.js        # 캐러셀 발행
    threads.js          # 텍스트+이미지 1장 발행
  web/
    server.js           # Express 앱 + API 라우트
    public/
      index.html        # 대시보드 SPA
      app.js
      style.css
  index.js              # 진입점: 서버 + 수집 에이전트 기동
tests/                  # node:test 테스트
data/                   # SQLite DB, 생성 이미지 (gitignore)
```

---

## 1단계 — 수집 + 생성 + 대시보드

### Task 1: 프로젝트 스캐폴딩 + 설정 모듈

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`, `src/config.js`
- Test: `tests/config.test.js`

**Interfaces:**
- Produces: `config` 객체 — `{ port, dataDir, imagesDir, geminiApiKey, geminiTextModel, geminiImageModel, ecosApiKey, cloudinary: {cloudName, apiKey, apiSecret}, meta: {igUserId, igAccessToken, threadsUserId, threadsAccessToken} }`

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "econ-content-pipeline",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 2: 의존성 설치**

```bash
npm install express better-sqlite3 node-cron rss-parser @google/genai playwright cloudinary dotenv
npx playwright install chromium
```

- [ ] **Step 3: .gitignore / .env.example 작성**

`.gitignore`:
```
node_modules/
data/
.env
```

`.env.example`:
```
PORT=3000
GEMINI_API_KEY=
GEMINI_TEXT_MODEL=gemini-2.5-flash
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image
ECOS_API_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
IG_USER_ID=
IG_ACCESS_TOKEN=
THREADS_USER_ID=
THREADS_ACCESS_TOKEN=
```

- [ ] **Step 4: 실패하는 테스트 작성** (`tests/config.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';

test('config가 기본값을 가진다', () => {
  assert.equal(typeof config.port, 'number');
  assert.equal(config.geminiTextModel.length > 0, true);
  assert.ok(config.dataDir.endsWith('data'));
});
```

- [ ] **Step 5: 실패 확인** — Run: `npm test` / Expected: FAIL (config.js 없음)

- [ ] **Step 6: src/config.js 구현**

```js
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const imagesDir = path.join(dataDir, 'images');
fs.mkdirSync(imagesDir, { recursive: true });

export const config = {
  port: Number(process.env.PORT || 3000),
  root,
  dataDir,
  imagesDir,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiTextModel: process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash',
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
  ecosApiKey: process.env.ECOS_API_KEY || '',
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  meta: {
    igUserId: process.env.IG_USER_ID || '',
    igAccessToken: process.env.IG_ACCESS_TOKEN || '',
    threadsUserId: process.env.THREADS_USER_ID || '',
    threadsAccessToken: process.env.THREADS_ACCESS_TOKEN || '',
  },
};
```

- [ ] **Step 7: 테스트 통과 확인** — Run: `npm test` / Expected: PASS
- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: 프로젝트 스캐폴딩 + 설정 모듈"`

---

### Task 2: DB 레이어 (스키마 + CRUD)

**Files:**
- Create: `src/db.js`
- Test: `tests/db.test.js`

**Interfaces:**
- Consumes: `config.dataDir`
- Produces:
  - `insertSource({type,title,url,summary,data})` → id (url 중복 시 무시하고 기존 id 반환, url 없으면 항상 삽입)
  - `listSources({status, type, limit})` → rows
  - `updateSourceStatus(id, status)`
  - `createDraft(sourceIds)` → id / `getDraft(id)` / `listDrafts()` / `updateDraftContent(id, contentObj)` / `updateDraftStatus(id, status)`
  - `saveCard({draftId, seq, template, imagePath, bgImagePath})` / `listCards(draftId)` / `deleteCards(draftId)`
  - `savePost({draftId, instagramUrl, threadsUrl, error})` / `listPosts()`
  - 테스트용: `openDb(filePath)` — 경로 주입 가능

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/db.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';

test('source 삽입·중복 제거·상태 변경', () => {
  const db = openDb(':memory:');
  const id1 = db.insertSource({ type: 'news', title: '기사A', url: 'https://a.com/1', summary: '요약', data: null });
  const id2 = db.insertSource({ type: 'news', title: '기사A-중복', url: 'https://a.com/1', summary: '', data: null });
  assert.equal(id1, id2);
  db.updateSourceStatus(id1, 'used');
  assert.equal(db.listSources({ status: 'used' }).length, 1);
});

test('draft 생명주기', () => {
  const db = openDb(':memory:');
  const sid = db.insertSource({ type: 'manual', title: '주제', url: null, summary: '', data: null });
  const did = db.createDraft([sid]);
  db.updateDraftContent(did, { caption: '캡션', cards: [{ template: 'cover', title: '표지' }], threadsText: '스레드 글' });
  db.updateDraftStatus(did, 'text_approved');
  const d = db.getDraft(did);
  assert.equal(d.status, 'text_approved');
  assert.equal(d.content.caption, '캡션');
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test` / Expected: FAIL
- [ ] **Step 3: src/db.js 구현**

```js
import Database from 'better-sqlite3';
import path from 'node:path';
import { config } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,             -- news|stock|realestate|manual
  title TEXT NOT NULL,
  url TEXT,
  summary TEXT,
  data TEXT,                      -- JSON
  status TEXT NOT NULL DEFAULT 'new',  -- new|used|archived
  collected_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_url ON sources(url) WHERE url IS NOT NULL;
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_ids TEXT NOT NULL,       -- JSON array
  content TEXT,                   -- JSON {caption, cards[], threadsText}
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL REFERENCES drafts(id),
  seq INTEGER NOT NULL,
  template TEXT NOT NULL,
  image_path TEXT,
  bg_image_path TEXT
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL REFERENCES drafts(id),
  instagram_url TEXT,
  threads_url TEXT,
  error TEXT,                     -- JSON
  published_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);`;

export function openDb(filePath) {
  const raw = new Database(filePath);
  raw.pragma('journal_mode = WAL');
  raw.exec(SCHEMA);
  return {
    raw,
    insertSource({ type, title, url = null, summary = '', data = null }) {
      if (url) {
        const dup = raw.prepare('SELECT id FROM sources WHERE url=?').get(url);
        if (dup) return dup.id;
      }
      const r = raw.prepare(
        'INSERT INTO sources (type,title,url,summary,data) VALUES (?,?,?,?,?)'
      ).run(type, title, url, summary, data ? JSON.stringify(data) : null);
      return Number(r.lastInsertRowid);
    },
    listSources({ status = null, type = null, limit = 100 } = {}) {
      let sql = 'SELECT * FROM sources WHERE 1=1';
      const args = [];
      if (status) { sql += ' AND status=?'; args.push(status); }
      if (type) { sql += ' AND type=?'; args.push(type); }
      sql += ' ORDER BY collected_at DESC LIMIT ?'; args.push(limit);
      return raw.prepare(sql).all(...args).map(rowWithData);
    },
    updateSourceStatus(id, status) {
      raw.prepare('UPDATE sources SET status=? WHERE id=?').run(status, id);
    },
    createDraft(sourceIds) {
      const r = raw.prepare('INSERT INTO drafts (source_ids) VALUES (?)')
        .run(JSON.stringify(sourceIds));
      return Number(r.lastInsertRowid);
    },
    getDraft(id) {
      const d = raw.prepare('SELECT * FROM drafts WHERE id=?').get(id);
      if (!d) return null;
      return { ...d, source_ids: JSON.parse(d.source_ids), content: d.content ? JSON.parse(d.content) : null };
    },
    listDrafts() {
      return raw.prepare('SELECT id, status, created_at, updated_at, content FROM drafts ORDER BY id DESC').all()
        .map(d => ({ ...d, content: d.content ? JSON.parse(d.content) : null }));
    },
    updateDraftContent(id, content) {
      raw.prepare("UPDATE drafts SET content=?, updated_at=datetime('now','localtime') WHERE id=?")
        .run(JSON.stringify(content), id);
    },
    updateDraftStatus(id, status) {
      raw.prepare("UPDATE drafts SET status=?, updated_at=datetime('now','localtime') WHERE id=?").run(status, id);
    },
    saveCard({ draftId, seq, template, imagePath = null, bgImagePath = null }) {
      const r = raw.prepare('INSERT INTO cards (draft_id,seq,template,image_path,bg_image_path) VALUES (?,?,?,?,?)')
        .run(draftId, seq, template, imagePath, bgImagePath);
      return Number(r.lastInsertRowid);
    },
    listCards(draftId) {
      return raw.prepare('SELECT * FROM cards WHERE draft_id=? ORDER BY seq').all(draftId);
    },
    deleteCards(draftId) {
      raw.prepare('DELETE FROM cards WHERE draft_id=?').run(draftId);
    },
    savePost({ draftId, instagramUrl = null, threadsUrl = null, error = null }) {
      const r = raw.prepare('INSERT INTO posts (draft_id,instagram_url,threads_url,error) VALUES (?,?,?,?)')
        .run(draftId, instagramUrl, threadsUrl, error ? JSON.stringify(error) : null);
      return Number(r.lastInsertRowid);
    },
    listPosts() {
      return raw.prepare('SELECT * FROM posts ORDER BY id DESC').all();
    },
  };
}

function rowWithData(row) {
  return { ...row, data: row.data ? JSON.parse(row.data) : null };
}

export const db = openDb(path.join(config.dataDir, 'db.sqlite'));
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `npm test` / Expected: PASS (2 tests)
- [ ] **Step 5: Commit** — `git commit -am "feat: SQLite DB 레이어"`

---

### Task 3: 뉴스 RSS 수집기

**Files:**
- Create: `src/collectors/news.js`
- Test: `tests/news.test.js`

**Interfaces:**
- Consumes: `db.insertSource`
- Produces: `collectNews(db)` → `Promise<number>` (신규 저장 건수). `FEEDS` 배열 export.

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/news.test.js`) — 파서 주입으로 네트워크 없이 검증

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { collectNews } from '../src/collectors/news.js';

test('RSS 아이템을 sources에 저장하고 중복은 건너뛴다', async () => {
  const db = openDb(':memory:');
  const fakeParser = {
    parseURL: async () => ({
      items: [
        { title: '기준금리 동결', link: 'https://n.com/1', contentSnippet: '한은이…' },
        { title: '기준금리 동결', link: 'https://n.com/1', contentSnippet: '중복' },
      ],
    }),
  };
  const count = await collectNews(db, fakeParser);
  assert.equal(db.listSources({ type: 'news' }).length, 1);
  assert.equal(count >= 1, true);
});
```

- [ ] **Step 2: 실패 확인** — `npm test` → FAIL
- [ ] **Step 3: src/collectors/news.js 구현**

```js
import Parser from 'rss-parser';

// 경제·부동산 섹션 RSS (수집 실패 시 해당 피드만 건너뜀)
export const FEEDS = [
  { name: '한국경제 경제', url: 'https://www.hankyung.com/feed/economy' },
  { name: '한국경제 부동산', url: 'https://www.hankyung.com/feed/realestate' },
  { name: '매일경제 경제', url: 'https://www.mk.co.kr/rss/30100041/' },
  { name: '매일경제 부동산', url: 'https://www.mk.co.kr/rss/50300009/' },
  { name: '연합뉴스 경제', url: 'https://www.yna.co.kr/rss/economy.xml' },
];

export async function collectNews(db, parser = new Parser({ timeout: 15000 })) {
  let saved = 0;
  for (const feed of FEEDS) {
    try {
      const res = await parser.parseURL(feed.url);
      for (const item of (res.items || []).slice(0, 20)) {
        if (!item.title || !item.link) continue;
        const before = db.listSources({ type: 'news', limit: 1 }).length;
        db.insertSource({
          type: 'news',
          title: item.title.trim(),
          url: item.link,
          summary: (item.contentSnippet || '').slice(0, 500),
          data: { feed: feed.name, pubDate: item.pubDate || null },
        });
        saved++;
      }
    } catch (e) {
      console.error(`[collect:news] ${feed.name} 실패:`, e.message);
    }
  }
  return saved;
}
```

(테스트의 fakeParser는 피드 수만큼 호출되므로 중복 URL은 UNIQUE 인덱스로 1건만 남는다.)

- [ ] **Step 4: 통과 확인** — `npm test` → PASS
- [ ] **Step 5: 실제 피드 스모크 테스트** — Run: `node -e "import('./src/collectors/news.js').then(async m=>{const {db}=await import('./src/db.js');console.log(await m.collectNews(db))})"` / Expected: 숫자 출력, `data/db.sqlite`에 뉴스 적재. RSS URL이 죽어 있으면 이 시점에 실제 동작하는 피드 URL로 교체한다.
- [ ] **Step 6: Commit** — `git commit -am "feat: 뉴스 RSS 수집기"`

---

### Task 4: 증시 데이터 수집기

**Files:**
- Create: `src/collectors/stocks.js`
- Test: `tests/stocks.test.js`

**Interfaces:**
- Produces: `collectStocks(db, fetchFn?)` → `Promise<number>`. 코스피·코스닥·원달러 스냅샷을 `type:'stock'` 소스 1건(제목: `증시 스냅샷 YYYY-MM-DD HH:mm`)으로 저장. `data`에 `{kospi:{value,change,changeRate}, kosdaq:{...}, usdkrw:{...}}`.

- [ ] **Step 1: 실패하는 테스트 작성** — fetch 주입

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { collectStocks } from '../src/collectors/stocks.js';

test('증시 스냅샷을 stock 소스로 저장한다', async () => {
  const db = openDb(':memory:');
  const fakeFetch = async (url) => ({
    ok: true,
    json: async () => url.includes('KOSPI')
      ? { closePrice: '2,650.12', compareToPreviousClosePrice: '12.34', fluctuationsRatio: '0.47' }
      : { closePrice: '860.55', compareToPreviousClosePrice: '-3.21', fluctuationsRatio: '-0.37' },
  });
  const n = await collectStocks(db, fakeFetch);
  assert.equal(n, 1);
  const s = db.listSources({ type: 'stock' })[0];
  assert.equal(s.data.kospi.value, 2650.12);
});
```

- [ ] **Step 2: 실패 확인** — `npm test` → FAIL
- [ ] **Step 3: 구현** (`src/collectors/stocks.js`)

```js
const NAVER = 'https://m.stock.naver.com/api/index';

function num(s) { return s == null ? null : Number(String(s).replace(/,/g, '')); }

async function fetchIndex(fetchFn, code) {
  const res = await fetchFn(`${NAVER}/${code}/basic`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${code} HTTP ${res.status}`);
  const j = await res.json();
  return { value: num(j.closePrice), change: num(j.compareToPreviousClosePrice), changeRate: num(j.fluctuationsRatio) };
}

export async function collectStocks(db, fetchFn = fetch) {
  try {
    const [kospi, kosdaq] = await Promise.all([
      fetchIndex(fetchFn, 'KOSPI'),
      fetchIndex(fetchFn, 'KOSDAQ'),
    ]);
    const now = new Date();
    const stamp = now.toISOString().slice(0, 16).replace('T', ' ');
    db.insertSource({
      type: 'stock',
      title: `증시 스냅샷 ${stamp}`,
      url: null,
      summary: `코스피 ${kospi.value} (${kospi.changeRate}%) / 코스닥 ${kosdaq.value} (${kosdaq.changeRate}%)`,
      data: { kospi, kosdaq, collectedAt: now.toISOString() },
    });
    return 1;
  } catch (e) {
    console.error('[collect:stocks] 실패:', e.message);
    return 0;
  }
}
```

- [ ] **Step 4: 통과 확인** — `npm test` → PASS
- [ ] **Step 5: 실제 스모크** — `node -e "..."`(Task 3과 동일 패턴). 네이버 엔드포인트가 응답하지 않으면 구현부의 URL만 교체(인터페이스 유지).
- [ ] **Step 6: Commit** — `git commit -am "feat: 증시 데이터 수집기"`

---

### Task 5: 부동산 공공 데이터 수집기 (ECOS 기준금리)

**Files:**
- Create: `src/collectors/realestate.js`
- Test: `tests/realestate.test.js`

**Interfaces:**
- Produces: `collectRealEstate(db, apiKey, fetchFn?)` → `Promise<number>`. `apiKey` 빈 문자열이면 0 반환(건너뜀). 최근 12개월 기준금리를 `type:'realestate'` 소스 1건으로 저장, `data.rates = [{time:'202606', value:2.5}, ...]`. 같은 달 데이터 중복 저장 방지: url 필드에 `ecos://base-rate/<최신월>` 저장.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { collectRealEstate } from '../src/collectors/realestate.js';

test('키 없으면 건너뛴다', async () => {
  const db = openDb(':memory:');
  assert.equal(await collectRealEstate(db, ''), 0);
});

test('기준금리를 realestate 소스로 저장, 같은 달 중복 방지', async () => {
  const db = openDb(':memory:');
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ StatisticSearch: { row: [
      { TIME: '202605', DATA_VALUE: '2.75' },
      { TIME: '202606', DATA_VALUE: '2.5' },
    ] } }),
  });
  await collectRealEstate(db, 'KEY', fakeFetch);
  await collectRealEstate(db, 'KEY', fakeFetch);
  assert.equal(db.listSources({ type: 'realestate' }).length, 1);
});
```

- [ ] **Step 2: 실패 확인** — `npm test` → FAIL
- [ ] **Step 3: 구현** (`src/collectors/realestate.js`)

```js
// 한국은행 ECOS 통계: 722Y001 = 한국은행 기준금리 (월)
export async function collectRealEstate(db, apiKey, fetchFn = fetch) {
  if (!apiKey) return 0;
  try {
    const end = new Date();
    const start = new Date(end.getFullYear() - 1, end.getMonth(), 1);
    const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    const url = `https://ecos.bok.or.kr/api/StatisticSearch/${apiKey}/json/kr/1/100/722Y001/M/${fmt(start)}/${fmt(end)}/0101000`;
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`ECOS HTTP ${res.status}`);
    const j = await res.json();
    const rows = j?.StatisticSearch?.row || [];
    if (!rows.length) return 0;
    const rates = rows.map(r => ({ time: r.TIME, value: Number(r.DATA_VALUE) }));
    const latest = rates[rates.length - 1];
    db.insertSource({
      type: 'realestate',
      title: `한국은행 기준금리 ${latest.value}% (${latest.time.slice(0,4)}.${latest.time.slice(4)})`,
      url: `ecos://base-rate/${latest.time}`,
      summary: `최근 12개월 기준금리 추이`,
      data: { rates },
    });
    return 1;
  } catch (e) {
    console.error('[collect:realestate] 실패:', e.message);
    return 0;
  }
}
```

- [ ] **Step 4: 통과 확인** — `npm test` → PASS
- [ ] **Step 5: Commit** — `git commit -am "feat: ECOS 기준금리 수집기"`

(국토부 실거래가는 지역·계약월 파라미터가 필요해 2단계 이후 확장 항목으로 미룸 — 스펙의 "키 있으면" 선택 항목.)

---

### Task 6: 백그라운드 수집 에이전트 (스케줄러)

**Files:**
- Create: `src/collectors/agent.js`
- Test: 수동 검증 (cron 등록은 통합 성격)

**Interfaces:**
- Consumes: `collectNews`, `collectStocks`, `collectRealEstate`, `db`, `config`
- Produces: `startAgent(db)` — cron 등록 + 기동 직후 1회 즉시 수집. `runAllCollectors(db)` → `Promise<{news,stocks,realestate}>` (대시보드 "지금 수집" 버튼에서도 사용)

- [ ] **Step 1: 구현** (`src/collectors/agent.js`)

```js
import cron from 'node-cron';
import { collectNews } from './news.js';
import { collectStocks } from './stocks.js';
import { collectRealEstate } from './realestate.js';
import { config } from '../config.js';

export async function runAllCollectors(db) {
  const [news, stocks, realestate] = await Promise.all([
    collectNews(db),
    collectStocks(db),
    collectRealEstate(db, config.ecosApiKey),
  ]);
  console.log(`[agent] 수집 완료 — 뉴스 ${news}, 증시 ${stocks}, 부동산 ${realestate}`);
  return { news, stocks, realestate };
}

export function startAgent(db) {
  cron.schedule('*/30 * * * *', () => collectNews(db));                  // 뉴스: 30분마다
  cron.schedule('5 9-16 * * 1-5', () => collectStocks(db));              // 증시: 평일 장중 매시 5분
  cron.schedule('0 8 * * *', () => collectRealEstate(db, config.ecosApiKey)); // 공공: 매일 08:00
  runAllCollectors(db); // 기동 직후 1회
  console.log('[agent] 백그라운드 수집 에이전트 시작');
}
```

- [ ] **Step 2: 수동 검증** — `node -e "import('./src/db.js').then(async({db})=>{const{runAllCollectors}=await import('./src/collectors/agent.js');console.log(await runAllCollectors(db));process.exit(0)})"` / Expected: 수집 건수 객체 출력
- [ ] **Step 3: Commit** — `git commit -am "feat: 백그라운드 수집 에이전트"`

---

### Task 7: Gemini 클라이언트 + 초안 생성기

**Files:**
- Create: `src/generator/gemini.js`, `src/generator/content.js`
- Test: `tests/content.test.js`

**Interfaces:**
- `gemini.js` Produces:
  - `generateText(prompt)` → `Promise<string>`
  - `generateImage(prompt)` → `Promise<Buffer|null>` (inline image bytes, 실패 시 null)
- `content.js` Produces:
  - `buildPrompt(sources)` → string (테스트 가능한 순수 함수)
  - `parseContent(text)` → `{caption, cards:[{template,title,body,dataLabel?}], threadsText}` (JSON 블록 추출·검증, 실패 시 throw)
  - `generateDraftContent(sources, genFn?)` → `Promise<content>` — genFn 주입 가능

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/content.test.js`)

```js
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
```

- [ ] **Step 2: 실패 확인** — `npm test` → FAIL
- [ ] **Step 3: src/generator/gemini.js 구현**

```js
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

let client = null;
function getClient() {
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다 (.env)');
  if (!client) client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  return client;
}

export async function generateText(prompt) {
  const res = await getClient().models.generateContent({
    model: config.geminiTextModel,
    contents: prompt,
  });
  return res.text;
}

export async function generateImage(prompt) {
  try {
    const res = await getClient().models.generateContent({
      model: config.geminiImageModel,
      contents: prompt,
    });
    for (const part of res.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.data) return Buffer.from(part.inlineData.data, 'base64');
    }
    return null;
  } catch (e) {
    console.error('[gemini:image] 실패:', e.message);
    return null;
  }
}
```

- [ ] **Step 4: src/generator/content.js 구현**

```js
import { generateText } from './gemini.js';

export function buildPrompt(sources) {
  const srcText = sources.map((s, i) =>
    `[소스${i + 1}] (${s.type}) ${s.title}\n${s.summary || ''}\n${s.data ? 'data: ' + JSON.stringify(s.data) : ''}`
  ).join('\n\n');
  return `너는 인스타그램 @apt_lap 스타일의 한국 경제·부동산 카드뉴스 에디터다.
아래 소스를 바탕으로 카드뉴스 구성안을 JSON으로만 출력하라.

${srcText}

규칙:
- 정보 전달 톤. 투자 조언·매수/매도 권유 금지.
- cards는 4~7장: 첫 장 template "cover"(짧고 강한 한 줄 제목), 중간 "text" 또는 "data"(소스에 수치가 있을 때, dataLabel에 수치 요약), 마지막 "outro"(팔로우 유도).
- title은 20자 이내, body는 80자 이내. 쉬운 한국어.
- caption: 인스타 캐프션 300자 이내 + 해시태그 8~12개.
- threadsText: 200자 이내, 핵심 요약 + "자세한 카드뉴스는 인스타그램에서" 유도 문구.

출력 형식(JSON만, 다른 텍스트 금지):
{"caption":"...","cards":[{"template":"cover","title":"...","body":"","dataLabel":""}],"threadsText":"..."}`;
}

export function parseContent(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = (m ? m[1] : text).trim();
  const obj = JSON.parse(jsonStr);
  if (!obj.caption || !Array.isArray(obj.cards) || obj.cards.length < 1 || !obj.threadsText) {
    throw new Error('생성 결과에 caption/cards/threadsText가 없습니다');
  }
  for (const c of obj.cards) {
    if (!['cover', 'text', 'data', 'outro'].includes(c.template)) c.template = 'text';
    c.title = c.title || '';
    c.body = c.body || '';
  }
  return obj;
}

export async function generateDraftContent(sources, genFn = generateText) {
  const raw = await genFn(buildPrompt(sources));
  return parseContent(raw);
}
```

- [ ] **Step 5: 통과 확인** — `npm test` → PASS
- [ ] **Step 6: Commit** — `git commit -am "feat: Gemini 초안 생성기"`

---

### Task 8: 카드 HTML 템플릿 + Playwright 렌더러

**Files:**
- Create: `src/renderer/templates.js`, `src/renderer/render.js`
- Test: `tests/templates.test.js` + 수동 이미지 확인

**Interfaces:**
- `templates.js` Produces: `renderCardHtml(card, {seq, total, bgDataUri})` → 완전한 HTML 문자열 (1080×1350 고정, 시스템 한글 폰트 스택)
- `render.js` Produces: `renderCards(draftId, cards, bgImages)` → `Promise<string[]>` (PNG 파일 경로 배열, `data/images/<draftId>/card-<seq>.png`)

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/templates.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCardHtml } from '../src/renderer/templates.js';

test('cover 템플릿에 제목·페이지 표시가 들어간다', () => {
  const html = renderCardHtml({ template: 'cover', title: '기준금리 동결', body: '' }, { seq: 1, total: 5, bgDataUri: null });
  assert.ok(html.includes('기준금리 동결'));
  assert.ok(html.includes('1080'));
});

test('HTML 특수문자 이스케이프', () => {
  const html = renderCardHtml({ template: 'text', title: 'a<b>', body: '' }, { seq: 2, total: 5, bgDataUri: null });
  assert.ok(!html.includes('a<b>'));
  assert.ok(html.includes('a&lt;b&gt;'));
});
```

- [ ] **Step 2: 실패 확인** — `npm test` → FAIL
- [ ] **Step 3: src/renderer/templates.js 구현**

```js
function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const BASE_CSS = `
* { margin:0; padding:0; box-sizing:border-box; }
html,body { width:1080px; height:1350px; overflow:hidden;
  font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif; }
.card { position:relative; width:1080px; height:1350px; display:flex; flex-direction:column;
  justify-content:center; padding:90px; color:#fff;
  background:linear-gradient(160deg,#0f2027,#203a43 50%,#2c5364); }
.bg { position:absolute; inset:0; background-size:cover; background-position:center; opacity:.35; }
.inner { position:relative; z-index:1; }
.brand { position:absolute; top:60px; left:90px; font-size:30px; letter-spacing:2px; opacity:.85; z-index:1; }
.page { position:absolute; top:60px; right:90px; font-size:28px; opacity:.7; z-index:1; }
h1 { font-size:88px; font-weight:800; line-height:1.25; word-break:keep-all; }
h2 { font-size:64px; font-weight:800; line-height:1.3; word-break:keep-all; margin-bottom:40px; }
p  { font-size:44px; line-height:1.6; word-break:keep-all; opacity:.95; }
.data { font-size:120px; font-weight:900; margin:50px 0; }
.outro h2 { font-size:72px; }
`;

export function renderCardHtml(card, { seq, total, bgDataUri = null, brand = 'ECON LAB' } = {}) {
  const bg = bgDataUri ? `<div class="bg" style="background-image:url('${bgDataUri}')"></div>` : '';
  let inner = '';
  if (card.template === 'cover') {
    inner = `<h1>${esc(card.title)}</h1>${card.body ? `<p style="margin-top:50px">${esc(card.body)}</p>` : ''}`;
  } else if (card.template === 'data') {
    inner = `<h2>${esc(card.title)}</h2><div class="data">${esc(card.dataLabel || '')}</div><p>${esc(card.body)}</p>`;
  } else if (card.template === 'outro') {
    inner = `<div class="outro"><h2>${esc(card.title)}</h2><p>${esc(card.body)}</p></div>`;
  } else {
    inner = `<h2>${esc(card.title)}</h2><p>${esc(card.body)}</p>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head>
<body><div class="card">${bg}
  <div class="brand">${esc(brand)}</div>
  <div class="page">${seq} / ${total}</div>
  <div class="inner">${inner}</div>
</div></body></html>`;
}
```

- [ ] **Step 4: src/renderer/render.js 구현**

```js
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { renderCardHtml } from './templates.js';

export async function renderCards(draftId, cards, bgImages = {}) {
  const dir = path.join(config.imagesDir, String(draftId));
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  const paths = [];
  try {
    for (let i = 0; i < cards.length; i++) {
      const bgBuf = bgImages[i];
      const bgDataUri = bgBuf ? `data:image/png;base64,${bgBuf.toString('base64')}` : null;
      const html = renderCardHtml(cards[i], { seq: i + 1, total: cards.length, bgDataUri });
      await page.setContent(html, { waitUntil: 'networkidle' });
      const file = path.join(dir, `card-${i + 1}.png`);
      await page.screenshot({ path: file });
      paths.push(file);
    }
  } finally {
    await browser.close();
  }
  return paths;
}
```

- [ ] **Step 5: 단위 테스트 통과 확인** — `npm test` → PASS
- [ ] **Step 6: 수동 렌더 확인** — 샘플 카드 3장을 렌더해 PNG를 눈으로 확인:

```bash
node -e "import('./src/renderer/render.js').then(async m=>{const p=await m.renderCards('sample',[{template:'cover',title:'기준금리 2.5% 동결',body:''},{template:'data',title:'기준금리 추이',dataLabel:'2.50%',body:'12개월째 인하 사이클'},{template:'outro',title:'팔로우하고 매일 받아보세요',body:''}]);console.log(p)})"
```

Expected: `data/images/sample/card-1..3.png` 생성, 한글 정상 렌더링(1080×1350).

- [ ] **Step 7: Commit** — `git commit -am "feat: 카드 템플릿 + Playwright 렌더러"`

---

### Task 9: Gemini 배경 이미지 생성 (+폴백)

**Files:**
- Create: `src/renderer/background.js`
- Test: `tests/background.test.js`

**Interfaces:**
- Produces: `generateBackgrounds(cards, imageFn?)` → `Promise<{[index]: Buffer}>` — cover 카드(0번)와 data 카드에만 배경 생성. `imageFn` 실패(null)나 예외 시 해당 인덱스 생략(폴백 = 템플릿 그라데이션). `buildBgPrompt(card)` → string.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
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

test('배경 프롬프트에 텍스트 금지 지시가 포함된다', () => {
  assert.ok(buildBgPrompt(CARDS[0]).toLowerCase().includes('no text'));
});
```

- [ ] **Step 2: 실패 확인** — `npm test` → FAIL
- [ ] **Step 3: 구현** (`src/renderer/background.js`)

```js
import { generateImage } from '../generator/gemini.js';

export function buildBgPrompt(card) {
  return `Abstract professional background image for a Korean finance/real-estate news card about "${card.title}". Dark navy and teal gradient mood, subtle geometric shapes or city skyline silhouette, premium editorial style. IMPORTANT: no text, no letters, no numbers, no watermarks. 4:5 portrait.`;
}

export async function generateBackgrounds(cards, imageFn = generateImage) {
  const out = {};
  for (let i = 0; i < cards.length; i++) {
    const t = cards[i].template;
    if (t !== 'cover' && t !== 'data') continue;
    try {
      const buf = await imageFn(buildBgPrompt(cards[i]));
      if (buf) out[i] = buf;
    } catch (e) {
      console.error(`[background] 카드 ${i} 배경 생성 실패:`, e.message);
    }
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인** — `npm test` → PASS
- [ ] **Step 5: Commit** — `git commit -am "feat: Gemini 배경 생성 + 폴백"`

---

### Task 10: Express 서버 + 대시보드 (1단계 완결)

**Files:**
- Create: `src/web/server.js`, `src/web/public/index.html`, `src/web/public/app.js`, `src/web/public/style.css`, `src/index.js`
- Test: `tests/server.test.js` (API만) + 브라우저 수동 검증

**Interfaces:**
- `server.js` Produces: `createServer(db)` → Express app. 라우트:
  - `GET /api/sources?status=new` / `POST /api/sources` (직접 입력: {title, summary}) 
  - `POST /api/collect` → runAllCollectors 즉시 실행
  - `POST /api/drafts` {sourceIds:[...]} → 초안 생성 + Gemini 글 생성 → draft 반환 (소스 status→used)
  - `GET /api/drafts` / `GET /api/drafts/:id`
  - `PUT /api/drafts/:id/content` {content} → 저장, `POST /api/drafts/:id/regenerate` → 글 재생성
  - `POST /api/drafts/:id/approve-text` → status `text_approved`
  - `POST /api/drafts/:id/images` → 배경 생성 + 카드 렌더 → status `images_ready`, 카드 경로 반환
  - `GET /api/drafts/:id/cards` / 이미지 정적 서빙 `GET /images/...` (data/images 매핑)
  - `GET /api/posts`
  - (2단계에서 추가) `POST /api/drafts/:id/publish`
- `index.js` Produces: 서버 listen + `startAgent(db)` 호출

- [ ] **Step 1: API 테스트 작성** (`tests/server.test.js`) — supertest 없이 fetch로:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createServer } from '../src/web/server.js';

const db = openDb(':memory:');
const app = createServer(db, { generateContent: async () => ({ caption: 'c', cards: [{ template: 'cover', title: 't', body: '' }], threadsText: 'th' }) });
const srv = app.listen(0);
const base = () => `http://127.0.0.1:${srv.address().port}`;
after(() => srv.close());

test('직접 입력 소스 등록 → 초안 생성 → 글 검수 흐름', async () => {
  let r = await fetch(base() + '/api/sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '수동 주제', summary: '메모' }) });
  const { id: sourceId } = await r.json();
  r = await fetch(base() + '/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sourceId] }) });
  const draft = await r.json();
  assert.equal(draft.content.caption, 'c');
  r = await fetch(base() + `/api/drafts/${draft.id}/approve-text`, { method: 'POST' });
  assert.equal((await r.json()).status, 'text_approved');
});
```

- [ ] **Step 2: 실패 확인** — `npm test` → FAIL
- [ ] **Step 3: src/web/server.js 구현** — 핵심 골격:

```js
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { generateDraftContent } from '../generator/content.js';
import { generateBackgrounds } from '../renderer/background.js';
import { renderCards } from '../renderer/render.js';
import { runAllCollectors } from '../collectors/agent.js';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

export function createServer(db, deps = {}) {
  const generateContent = deps.generateContent || generateDraftContent;
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(pub));
  app.use('/images', express.static(config.imagesDir));

  app.get('/api/sources', (req, res) =>
    res.json(db.listSources({ status: req.query.status || null, type: req.query.type || null })));

  app.post('/api/sources', (req, res) => {
    const { title, summary = '' } = req.body;
    if (!title) return res.status(400).json({ error: 'title 필요' });
    const id = db.insertSource({ type: 'manual', title, url: null, summary, data: null });
    res.json({ id });
  });

  app.post('/api/collect', async (_req, res) => {
    try { res.json(await runAllCollectors(db)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/drafts', async (req, res) => {
    const { sourceIds } = req.body;
    if (!Array.isArray(sourceIds) || !sourceIds.length) return res.status(400).json({ error: 'sourceIds 필요' });
    try {
      const sources = sourceIds.map(id => db.listSources({ limit: 1000 }).find(s => s.id === id)).filter(Boolean);
      const content = await generateContent(sources);
      const draftId = db.createDraft(sourceIds);
      db.updateDraftContent(draftId, content);
      sourceIds.forEach(id => db.updateSourceStatus(id, 'used'));
      res.json(db.getDraft(draftId));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/drafts', (_req, res) => res.json(db.listDrafts()));
  app.get('/api/drafts/:id', (req, res) => {
    const d = db.getDraft(Number(req.params.id));
    return d ? res.json(d) : res.status(404).json({ error: 'not found' });
  });

  app.put('/api/drafts/:id/content', (req, res) => {
    db.updateDraftContent(Number(req.params.id), req.body.content);
    res.json(db.getDraft(Number(req.params.id)));
  });

  app.post('/api/drafts/:id/regenerate', async (req, res) => {
    const d = db.getDraft(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'not found' });
    try {
      const sources = d.source_ids.map(id => db.listSources({ limit: 1000 }).find(s => s.id === id)).filter(Boolean);
      const content = await generateContent(sources);
      db.updateDraftContent(d.id, content);
      res.json(db.getDraft(d.id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/drafts/:id/approve-text', (req, res) => {
    db.updateDraftStatus(Number(req.params.id), 'text_approved');
    res.json(db.getDraft(Number(req.params.id)));
  });

  app.post('/api/drafts/:id/images', async (req, res) => {
    const d = db.getDraft(Number(req.params.id));
    if (!d?.content?.cards?.length) return res.status(400).json({ error: '카드 문구가 없습니다' });
    try {
      const bgs = await generateBackgrounds(d.content.cards);
      const paths = await renderCards(d.id, d.content.cards, bgs);
      db.deleteCards(d.id);
      paths.forEach((p, i) => db.saveCard({ draftId: d.id, seq: i + 1, template: d.content.cards[i].template, imagePath: p }));
      db.updateDraftStatus(d.id, 'images_ready');
      res.json({ cards: db.listCards(d.id) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/drafts/:id/cards', (req, res) => res.json(db.listCards(Number(req.params.id))));
  app.get('/api/posts', (_req, res) => res.json(db.listPosts()));
  return app;
}
```

- [ ] **Step 4: src/index.js 구현**

```js
import { config } from './config.js';
import { db } from './db.js';
import { createServer } from './web/server.js';
import { startAgent } from './collectors/agent.js';

createServer(db).listen(config.port, () => {
  console.log(`대시보드: http://localhost:${config.port}`);
});
startAgent(db);
```

- [ ] **Step 5: API 테스트 통과 확인** — `npm test` → PASS

- [ ] **Step 6: 대시보드 프런트 작성** (`index.html`, `app.js`, `style.css`)

화면 3개 탭 구성 — 프레임워크 없이 fetch + DOM:
- **소스함**: 소스 카드 목록(유형 필터, 체크박스 다중 선택), [직접 입력] 폼, [지금 수집] 버튼, 선택 소스로 [콘텐츠 만들기] 버튼 → POST /api/drafts
- **초안**: 초안 목록 + 상세. 상세에서 caption/threadsText/카드별 title·body를 textarea로 인라인 편집(PUT content), [재생성], [글 확정](approve-text), 확정 후 [이미지 생성](POST images) → `/images/<id>/card-N.png` 미리보기를 인스타풍 가로 스크롤 캐러셀로 표시, [이미지 다시 생성] 버튼, (2단계에서 [배포] 버튼 추가)
- **발행 이력**: GET /api/posts 테이블

`app.js`는 `api(path, opts)` 헬퍼 + 탭별 render 함수로 구성. 스타일은 다크 테마, 카드 그리드. (코드 분량상 여기 생략하지 않고 구현 시 완성할 것 — 기능 명세는 위가 전부다.)

- [ ] **Step 7: 브라우저 수동 검증** — `npm start` 후 `localhost:3000`에서: 지금 수집 → 소스 떴는지 → 직접 입력 주제로 초안 생성(Gemini 키 필요) → 글 수정 → 이미지 생성 → 카드 미리보기 확인.
- [ ] **Step 8: Commit** — `git commit -am "feat: 대시보드 + 1단계 파이프라인 완성"`

---

## 2단계 — 발행 (Instagram + Threads)

### Task 11: Cloudinary 업로더

**Files:**
- Create: `src/publisher/hosting.js`
- Test: `tests/hosting.test.js` (설정 검증만) + 실키 수동 확인

**Interfaces:**
- Produces: `uploadImages(paths)` → `Promise<string[]>` (https 공개 URL 배열). 키 미설정 시 명확한 오류 throw.

- [ ] **Step 1: 테스트 작성** — 키 없을 때 오류 메시지 검증

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadImages } from '../src/publisher/hosting.js';

test('Cloudinary 키 없으면 안내 오류', async () => {
  await assert.rejects(() => uploadImages(['x.png']), /CLOUDINARY/);
});
```

- [ ] **Step 2: 구현** (`src/publisher/hosting.js`)

```js
import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config.js';

export async function uploadImages(paths) {
  const { cloudName, apiKey, apiSecret } = config.cloudinary;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET을 .env에 설정하세요');
  }
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
  const urls = [];
  for (const p of paths) {
    const r = await cloudinary.uploader.upload(p, { folder: 'econ-cards' });
    urls.push(r.secure_url);
  }
  return urls;
}
```

- [ ] **Step 3: 테스트 + 실키 수동 확인** — `npm test` PASS 후, 키 설정 뒤 카드 1장 업로드해 URL 접속 확인.
- [ ] **Step 4: Commit** — `git commit -am "feat: Cloudinary 이미지 호스팅"`

---

### Task 12: Instagram 발행기

**Files:**
- Create: `src/publisher/instagram.js`
- Test: `tests/instagram.test.js` (fetch 주입)

**Interfaces:**
- Produces: `publishToInstagram({imageUrls, caption}, fetchFn?)` → `Promise<{id, permalink}>`. 흐름: 이미지별 자식 컨테이너 생성(`is_carousel_item=true`) → CAROUSEL 컨테이너 → `media_publish` → permalink 조회. 이미지 1장이면 캐러셀 없이 단일 게시. 각 단계 실패 시 단계명을 포함한 Error throw.

- [ ] **Step 1: 테스트 작성** — fakeFetch로 3단계 호출 순서·파라미터 검증

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishToInstagram } from '../src/publisher/instagram.js';

test('캐러셀 발행 3단계 호출', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push(url);
    if (url.includes('media_publish')) return { ok: true, json: async () => ({ id: 'post1' }) };
    if (url.includes('permalink')) return { ok: true, json: async () => ({ permalink: 'https://instagram.com/p/x' }) };
    return { ok: true, json: async () => ({ id: 'c' + calls.length }) };
  };
  const r = await publishToInstagram({ imageUrls: ['https://a/1.png', 'https://a/2.png'], caption: '캡션' },
    fakeFetch, { igUserId: 'U', igAccessToken: 'T' });
  assert.equal(r.permalink.includes('instagram.com'), true);
  assert.equal(calls.filter(u => u.includes('/media?') || u.includes('/media&')).length >= 3, true); // 자식2 + 캐러셀1
});
```

- [ ] **Step 2: 구현** (`src/publisher/instagram.js`)

```js
import { config } from '../config.js';

const G = 'https://graph.facebook.com/v21.0';

async function call(fetchFn, url, step) {
  const res = await fetchFn(url, { method: 'POST' });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(`[instagram:${step}] ${j.error?.message || res.status}`);
  return j;
}

export async function publishToInstagram({ imageUrls, caption }, fetchFn = fetch, creds = config.meta) {
  const { igUserId, igAccessToken } = creds;
  if (!igUserId || !igAccessToken) throw new Error('IG_USER_ID / IG_ACCESS_TOKEN을 .env에 설정하세요');
  const enc = encodeURIComponent;
  let creationId;

  if (imageUrls.length === 1) {
    const c = await call(fetchFn,
      `${G}/${igUserId}/media?image_url=${enc(imageUrls[0])}&caption=${enc(caption)}&access_token=${igAccessToken}`, 'container');
    creationId = c.id;
  } else {
    const children = [];
    for (const u of imageUrls) {
      const c = await call(fetchFn,
        `${G}/${igUserId}/media?image_url=${enc(u)}&is_carousel_item=true&access_token=${igAccessToken}`, 'child');
      children.push(c.id);
    }
    const carousel = await call(fetchFn,
      `${G}/${igUserId}/media?media_type=CAROUSEL&children=${children.join(',')}&caption=${enc(caption)}&access_token=${igAccessToken}`, 'carousel');
    creationId = carousel.id;
  }

  const pub = await call(fetchFn, `${G}/${igUserId}/media_publish?creation_id=${creationId}&access_token=${igAccessToken}`, 'publish');
  const permRes = await fetchFn(`${G}/${pub.id}?fields=permalink&access_token=${igAccessToken}`);
  const perm = await permRes.json();
  return { id: pub.id, permalink: perm.permalink || null };
}
```

(permalink 조회는 GET이므로 `call` 대신 직접 fetch — 테스트 fakeFetch에서 URL에 `permalink` 포함으로 분기.)

- [ ] **Step 3: 통과 확인** — `npm test` → PASS
- [ ] **Step 4: Commit** — `git commit -am "feat: Instagram 캐러셀 발행기"`

---

### Task 13: Threads 발행기

**Files:**
- Create: `src/publisher/threads.js`
- Test: `tests/threads.test.js`

**Interfaces:**
- Produces: `publishToThreads({text, imageUrl}, fetchFn?, creds?)` → `Promise<{id, permalink}>`. 컨테이너 생성(IMAGE+text, imageUrl 없으면 TEXT) → `threads_publish` → permalink 조회.

- [ ] **Step 1: 테스트 작성**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishToThreads } from '../src/publisher/threads.js';

test('이미지+텍스트 스레드 발행 2단계', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes('threads_publish')) return { ok: true, json: async () => ({ id: 'th1' }) };
    if (url.includes('permalink')) return { ok: true, json: async () => ({ permalink: 'https://threads.net/@u/post/x' }) };
    return { ok: true, json: async () => ({ id: 'container1' }) };
  };
  const r = await publishToThreads({ text: '요약 글', imageUrl: 'https://a/1.png' },
    fakeFetch, { threadsUserId: 'U', threadsAccessToken: 'T' });
  assert.ok(r.permalink.includes('threads'));
  assert.ok(calls[0].includes('media_type=IMAGE'));
});
```

- [ ] **Step 2: 구현** (`src/publisher/threads.js`)

```js
import { config } from '../config.js';

const T = 'https://graph.threads.net/v1.0';

export async function publishToThreads({ text, imageUrl = null }, fetchFn = fetch, creds = config.meta) {
  const { threadsUserId, threadsAccessToken } = creds;
  if (!threadsUserId || !threadsAccessToken) throw new Error('THREADS_USER_ID / THREADS_ACCESS_TOKEN을 .env에 설정하세요');
  const enc = encodeURIComponent;

  const mediaParams = imageUrl
    ? `media_type=IMAGE&image_url=${enc(imageUrl)}&text=${enc(text)}`
    : `media_type=TEXT&text=${enc(text)}`;
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
```

- [ ] **Step 3: 통과 확인** — `npm test` → PASS
- [ ] **Step 4: Commit** — `git commit -am "feat: Threads 발행기"`

---

### Task 14: 배포 통합 (API + 대시보드 배포 버튼)

**Files:**
- Modify: `src/web/server.js` (publish 라우트 추가), `src/web/public/app.js` (배포 버튼 + 이력 표시)
- Test: `tests/publish.test.js`

**Interfaces:**
- Produces: `POST /api/drafts/:id/publish` — 흐름: 카드 이미지 Cloudinary 업로드 → Instagram 캐러셀(전체 카드 + caption) → Threads(threadsText + 카드 1번 URL) → posts 기록, draft status `published`. 부분 실패 허용: 인스타/스레드 각각 결과·오류를 `posts.error` JSON에 기록하고 200으로 상세 반환. 둘 다 실패면 500.

- [ ] **Step 1: 테스트 작성** — publisher/hosting 모두 주입 가능하게 `createServer(db, deps)` 확장:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createServer } from '../src/web/server.js';

const db = openDb(':memory:');
const app = createServer(db, {
  generateContent: async () => ({ caption: 'c', cards: [{ template: 'cover', title: 't', body: '' }], threadsText: 'th' }),
  uploadImages: async (paths) => paths.map((_, i) => `https://cdn/x${i}.png`),
  publishInstagram: async () => ({ id: 'ig1', permalink: 'https://instagram.com/p/x' }),
  publishThreads: async () => { throw new Error('threads down'); },
});
const srv = app.listen(0);
const base = () => `http://127.0.0.1:${srv.address().port}`;
after(() => srv.close());

test('부분 실패 시에도 성공한 플랫폼 기록', async () => {
  const sid = db.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
  let r = await fetch(base() + '/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sid] }) });
  const draft = await r.json();
  db.saveCard({ draftId: draft.id, seq: 1, template: 'cover', imagePath: 'data/images/x/card-1.png' });
  db.updateDraftStatus(draft.id, 'images_ready');
  r = await fetch(base() + `/api/drafts/${draft.id}/publish`, { method: 'POST' });
  const out = await r.json();
  assert.equal(out.instagram.permalink.includes('instagram'), true);
  assert.equal(out.threads.error, 'threads down');
  assert.equal(db.listPosts().length, 1);
});
```

- [ ] **Step 2: 실패 확인** — `npm test` → FAIL
- [ ] **Step 3: server.js에 publish 라우트 추가**

```js
// createServer(db, deps)에 추가:
// const uploadImages = deps.uploadImages || (await import('../publisher/hosting.js')).uploadImages 형태 대신
// 상단 정적 import + deps 오버라이드 패턴 사용:
//   import { uploadImages as defaultUpload } from '../publisher/hosting.js'; 등
app.post('/api/drafts/:id/publish', async (req, res) => {
  const d = db.getDraft(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'not found' });
  const cards = db.listCards(d.id);
  if (d.status !== 'images_ready' || !cards.length) return res.status(400).json({ error: '이미지 생성이 완료되지 않았습니다' });
  const result = { instagram: null, threads: null };
  try {
    const urls = await uploadImages(cards.map(c => c.image_path));
    try { result.instagram = await publishInstagram({ imageUrls: urls, caption: d.content.caption }); }
    catch (e) { result.instagram = { error: e.message }; }
    try { result.threads = await publishThreads({ text: d.content.threadsText, imageUrl: urls[0] }); }
    catch (e) { result.threads = { error: e.message }; }
  } catch (e) {
    return res.status(500).json({ error: `이미지 업로드 실패: ${e.message}` });
  }
  const anyOk = result.instagram?.permalink || result.threads?.permalink;
  db.savePost({
    draftId: d.id,
    instagramUrl: result.instagram?.permalink || null,
    threadsUrl: result.threads?.permalink || null,
    error: (result.instagram?.error || result.threads?.error) ? result : null,
  });
  if (anyOk) db.updateDraftStatus(d.id, 'published');
  return anyOk ? res.json(result) : res.status(500).json(result);
});
```

- [ ] **Step 4: 통과 확인** — `npm test` → PASS
- [ ] **Step 5: 대시보드에 [배포] 버튼 + 결과 표시 추가** — `images_ready` 상태 초안 상세에 배포 버튼, 클릭 시 확인 모달("Instagram과 Threads에 게시합니다") → 결과 permalink 링크 표시. 발행 이력 탭에 posts 반영.
- [ ] **Step 6: Commit** — `git commit -am "feat: 원클릭 배포 통합"`

---

### Task 15: 실계정 연동 설정 (코드 아님 — 사용자와 함께)

- [ ] 인스타그램 프로페셔널 계정 전환 + Facebook 페이지 연결
- [ ] Meta 개발자 앱 생성 → Instagram Graph API 권한(`instagram_basic`, `instagram_content_publish`) + 장기 토큰 발급 → `.env`의 `IG_USER_ID`, `IG_ACCESS_TOKEN`
- [ ] Threads API 사용 설정(`threads_basic`, `threads_content_publish`) + 토큰 → `.env`
- [ ] Gemini API 키, Cloudinary 무료 계정, (선택) ECOS 키 → `.env`
- [ ] 테스트 게시 1건 실발행 → 인스타·Threads에서 확인 → 필요 시 즉시 삭제

---

## Self-Review 결과

- 스펙 커버리지: 수집(뉴스/증시/공공/수동)=T3~5,10 · 상시 수집 에이전트=T6 · 글 생성=T7 · 하이브리드 이미지=T8~9 · 대시보드 검수=T10 · 발행=T11~14 · 준비물=T15. 국토부 실거래가는 스펙상 "키 있으면" 항목으로 2단계 이후 확장으로 명시(T5 비고).
- 타입 일관성: `content` 형태 `{caption, cards[{template,title,body,dataLabel?}], threadsText}`를 T7 생성 → T8 렌더 → T10 API → T14 발행에서 동일하게 사용. `createServer(db, deps)` 주입 시그니처 T10/T14 일치.
- 외부 API(네이버 시세, RSS URL)는 스모크 테스트 단계에서 실제 검증하고 죽은 엔드포인트는 인터페이스 유지한 채 교체하도록 명시.
