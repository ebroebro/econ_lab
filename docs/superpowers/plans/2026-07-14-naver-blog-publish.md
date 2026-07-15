# 네이버 블로그 배포 (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 카드뉴스 초안을, 같은 내용의 네이버 블로그 글(카드 이미지 포함)로 변환해 임시저장까지 자동화한다.

**Architecture:** 순수 추가형. 기존 Instagram/Threads 배포 경로는 손대지 않고, 배포 단계에 "네이버 블로그" 출구를 하나 더 붙인다. 네이버 에디터 자동화는 이미 완성·검증된 외부 프로젝트 `naver-blog-mcp`(Python/Playwright)를 **수정 없이 stdio 자식 프로세스로 spawn**해서 재사용한다. 우리 앱은 `@modelcontextprotocol/sdk`로 그 MCP의 `naver_blog_create_post` 툴을 호출하기만 한다. 블로그 본문은 Gemini가 카드 스토리를 재료로 새로 생성(`[사진N]`/`[구분선]`/`[인용구]` 마커 포함)하고, 카드 이미지를 마커 위치에 끼워 넣어 순서형 blocks로 만든다.

**Tech Stack:** Node ESM, Express 5, `@modelcontextprotocol/sdk`(신규), better-sqlite3, node:test, Gemini(@google/genai). 외부: `naver-blog-mcp`(Python 3.13 + uv + Playwright) — 이미 이 PC에 설치·설정됨.

## Global Constraints

- **`naver-blog-mcp` 프로젝트는 절대 수정하지 않는다** — spawn(`uv run naver-blog-mcp`)만 한다. 참조 프로젝트 `naver-blog-writer`의 `mcpClient.ts`가 검증한 패턴 그대로.
- **기존 Instagram/Threads 배포 경로(`publisher/instagram.js`, `threads.js`, `POST /api/drafts/:id/publish`)를 변경하지 않는다.**
- 네이버 발행은 **항상 임시저장(`publish: false`)**. 최종 발행은 사용자가 네이버에서 직접.
- 새 배포 모듈은 기존 publisher처럼 **의존성 주입(DI)** 으로 테스트 가능하게 만든다(실제 MCP/Gemini 호출을 목으로 대체 가능).
- 테스트는 기존 방식 유지: `node --import ./tests/setup.mjs --test "tests/*.test.js"`, `DATA_DIR`로 운영 데이터 격리.
- Node ESM(`import`), 파일 상단 한글 주석은 "왜"를 설명(기존 코드 스타일 준수).
- 네이버 계정 정보는 우리 앱이 절대 보관/전달하지 않는다 — MCP 서버가 자기 `.env`로 처리.

---

## File Structure

- **Create `src/publisher/naverBlocks.js`** — 블로그 본문(마커 포함 텍스트) + 카드 이미지 경로 배열 → MCP가 순서대로 재생할 `blocks`(text/image/divider/quote)로 변환. 순수 함수, 부작용 없음.
- **Create `src/publisher/naverBlog.js`** — `@modelcontextprotocol/sdk`로 `naver-blog-mcp`를 stdio로 띄워 `naver_blog_create_post`를 `publish:false`로 호출. DI로 클라이언트 팩토리 주입 가능.
- **Create `src/publisher/naverJobStore.js`** — 인메모리 작업 상태 저장(블로그 포스팅은 30초~2분 + CAPTCHA 가능 → 비동기 job + 폴링).
- **Modify `src/config.js`** — `naverBlogMcpDir` 추가.
- **Modify `.env.example`** — `NAVER_BLOG_MCP_DIR` 추가.
- **Modify `src/generator/content.js`** — `buildBlogPrompt`/`parseBlogContent`/`generateBlogDraft` 추가(블로그 전용 본문 생성).
- **Modify `src/web/server.js`** — 라우트 3개 추가(`POST /api/drafts/:id/blog`, `POST /api/drafts/:id/publish-naver`, `GET /api/naver-jobs/:jobId`) + DI 배선.
- **Modify `src/web/public/index.html` / `app.js` / `style.css`** — 초안 상세에 블로그 본문 생성/편집 + 네이버 임시저장 + 상태 표시 UI.
- **Modify `package.json`** — `@modelcontextprotocol/sdk` 의존성.
- **Tests:** `tests/naverBlocks.test.js`, `tests/naverBlog.test.js`, `tests/content.test.js`(블로그 파서 추가), `tests/server.test.js`(라우트 추가).

---

### Task 1: naverBlocks.js — 본문+이미지 → blocks 변환 (순수 함수)

**Files:**
- Create: `src/publisher/naverBlocks.js`
- Test: `tests/naverBlocks.test.js`

**Interfaces:**
- Produces:
  - `buildBlocks(body: string, imagePaths: string[]): Block[]`
    - `Block = { type:'text', text } | { type:'image', path } | { type:'divider' } | { type:'quote', text }`
    - 마커: `[사진N]`(1-based, `imagePaths[N-1]`로 매핑) → image 블록; `[구분선]` → divider; `[인용구]...[/인용구]` → quote. 선두/말미/연속 divider 억제. 빈 text 블록 스킵.

- [ ] **Step 1: 실패 테스트 작성**

`tests/naverBlocks.test.js`:
```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --import ./tests/setup.mjs --test tests/naverBlocks.test.js`
Expected: FAIL — `Cannot find module '../src/publisher/naverBlocks.js'`

- [ ] **Step 3: 구현**

`src/publisher/naverBlocks.js`:
```js
// 블로그 본문(마커 포함 텍스트)과 카드 이미지 경로 배열을, 네이버 블로그 MCP가 순서대로
// 재생할 blocks로 변환한다. 참조: naver-blog-writer의 buildBlocks/splitBody 패턴.
const DIVIDER_TOKEN = '[구분선]';
const QUOTE_RE = /\[인용구\]([\s\S]*?)\[\/인용구\]/;
const PHOTO_RE = /\[사진(\d+)\]/g;

// 본문을 [사진N] 기준으로 잘라 text/image 세그먼트로 나눈다. 매핑되는 이미지가 없는
// [사진N]은 자리표시자를 제거해 본문에 남지 않게 한다.
function splitByPhotos(body, imagePaths) {
  const segments = [];
  let last = 0;
  let m;
  PHOTO_RE.lastIndex = 0;
  while ((m = PHOTO_RE.exec(body))) {
    const idx = Number(m[1]) - 1;
    const path = imagePaths[idx];
    if (m.index > last) segments.push({ type: 'text', text: body.slice(last, m.index) });
    if (path) segments.push({ type: 'image', path });
    last = m.index + m[0].length;
  }
  if (last < body.length) segments.push({ type: 'text', text: body.slice(last) });
  return segments;
}

export function buildBlocks(body, imagePaths = []) {
  const blocks = [];

  const pushDivider = () => {
    if (blocks.length === 0) return;              // 선두 구분선 금지
    if (blocks.at(-1)?.type === 'divider') return; // 연속 구분선 금지
    blocks.push({ type: 'divider' });
  };

  const pushTextWithDividers = (text) => {
    const parts = text.split(DIVIDER_TOKEN);
    parts.forEach((part, i) => {
      if (i > 0) pushDivider();
      if (part.trim().length === 0) return;
      blocks.push({ type: 'text', text: part });
    });
  };

  for (const seg of splitByPhotos(body, imagePaths)) {
    if (seg.type === 'image') { blocks.push(seg); continue; }
    let remaining = seg.text;
    let match;
    while ((match = QUOTE_RE.exec(remaining))) {
      pushTextWithDividers(remaining.slice(0, match.index));
      const quoteText = match[1].trim();
      if (quoteText.length > 0) blocks.push({ type: 'quote', text: quoteText });
      remaining = remaining.slice(match.index + match[0].length);
    }
    pushTextWithDividers(remaining);
  }

  while (blocks.at(-1)?.type === 'divider') blocks.pop(); // 말미 구분선 제거
  return blocks;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import ./tests/setup.mjs --test tests/naverBlocks.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/publisher/naverBlocks.js tests/naverBlocks.test.js
git commit -m "feat(naver): 블로그 본문+카드이미지 → MCP blocks 변환 모듈"
```

---

### Task 2: naverBlog.js — MCP 클라이언트로 임시저장

**Files:**
- Create: `src/publisher/naverBlog.js`
- Modify: `src/config.js` (naverBlogMcpDir)
- Modify: `.env.example`
- Modify: `package.json` (`@modelcontextprotocol/sdk`)
- Test: `tests/naverBlog.test.js`

**Interfaces:**
- Consumes: `buildBlocks` (Task 1)
- Produces:
  - `postToNaverBlog({ title, body, imagePaths, tags }, deps?): Promise<{ success:boolean, message:string, postUrl:string|null }>`
    - `deps.mcpDir` (기본 `config.naverBlogMcpDir`), `deps.connect` (기본 실제 stdio 연결; 테스트는 목 주입)
    - `deps.connect()`는 `{ callTool(args), close() }` 형태의 클라이언트를 반환한다.

- [ ] **Step 1: 의존성 설치**

Run: `npm install @modelcontextprotocol/sdk`
Expected: `package.json`/`package-lock.json`에 추가됨.

- [ ] **Step 2: config에 mcpDir 추가**

`src/config.js`의 `export const config = {` 블록에 추가:
```js
  naverBlogMcpDir: process.env.NAVER_BLOG_MCP_DIR || '',
```
`.env.example`에 추가:
```
# 네이버 블로그 자동화 MCP 서버(naver-blog-mcp) 폴더 경로. 그 폴더의 .env에 NAVER_BLOG_ID/PASSWORD 설정 필요.
NAVER_BLOG_MCP_DIR=
```

- [ ] **Step 3: 실패 테스트 작성**

`tests/naverBlog.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postToNaverBlog } from '../src/publisher/naverBlog.js';

function fakeConnect(captured, toolText) {
  return async () => ({
    async callTool(args) { captured.push(args); return { content: [{ type: 'text', text: toolText }] }; },
    async close() { captured.push('closed'); },
  });
}

test('postToNaverBlog은 blocks로 변환해 publish:false로 툴을 호출하고 결과를 파싱한다', async () => {
  const captured = [];
  const res = await postToNaverBlog(
    { title: '제목', body: '문단\n[사진1]', imagePaths: ['/img/1.png'], tags: ['경제'] },
    { mcpDir: '/x', connect: fakeConnect(captured, JSON.stringify({ success: true, message: '임시저장 완료', post_url: null })) },
  );
  assert.equal(res.success, true);
  assert.equal(res.message, '임시저장 완료');
  const call = captured.find((c) => c && c.name === 'naver_blog_create_post');
  assert.equal(call.arguments.title, '제목');
  assert.equal(call.arguments.publish, false);
  assert.deepEqual(call.arguments.tags, ['경제']);
  assert.deepEqual(call.arguments.blocks, [
    { type: 'text', text: '문단\n' },
    { type: 'image', path: '/img/1.png' },
  ]);
  assert.ok(captured.includes('closed')); // 항상 close
});

test('mcpDir 미설정이면 success:false로 안내한다', async () => {
  const res = await postToNaverBlog({ title: 't', body: 'b', imagePaths: [], tags: [] }, { mcpDir: '' });
  assert.equal(res.success, false);
  assert.match(res.message, /NAVER_BLOG_MCP_DIR/);
});

test('툴이 JSON이 아닌 에러문을 반환하면 success:false로 감싼다', async () => {
  const captured = [];
  const res = await postToNaverBlog(
    { title: 't', body: 'b', imagePaths: [], tags: [] },
    { mcpDir: '/x', connect: fakeConnect(captured, '로그인 실패: CAPTCHA') },
  );
  assert.equal(res.success, false);
  assert.match(res.message, /CAPTCHA/);
});
```

- [ ] **Step 4: 실패 확인**

Run: `node --import ./tests/setup.mjs --test tests/naverBlog.test.js`
Expected: FAIL — 모듈 없음.

- [ ] **Step 5: 구현**

`src/publisher/naverBlog.js`:
```js
import { config } from '../config.js';
import { buildBlocks } from './naverBlocks.js';

const TOOL_TIMEOUT_MS = 5 * 60 * 1000; // 로그인/CAPTCHA/에디터 로딩까지 넉넉히.

// 실제 stdio 연결: naver-blog-mcp를 `uv run naver-blog-mcp`로 띄운다. 이 프로젝트는
// 절대 수정하지 않고 spawn만 한다. 테스트에서는 deps.connect로 목을 주입한다.
async function defaultConnect(mcpDir) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({
    command: 'uv',
    args: ['run', 'naver-blog-mcp'],
    cwd: mcpDir,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const client = new Client({ name: 'econ-content-pipeline', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

function extractText(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return '';
  return content.find((c) => c?.type === 'text' && typeof c.text === 'string')?.text ?? '';
}

function parseToolResult(text) {
  try {
    const j = JSON.parse(text);
    return { success: Boolean(j.success), message: String(j.message ?? ''), postUrl: j.post_url ?? null };
  } catch {
    return { success: false, message: text || '알 수 없는 오류', postUrl: null };
  }
}

export async function postToNaverBlog({ title, body, imagePaths = [], tags = [] }, deps = {}) {
  const mcpDir = deps.mcpDir ?? config.naverBlogMcpDir;
  if (!mcpDir) {
    return { success: false, message: 'NAVER_BLOG_MCP_DIR 환경변수가 설정되지 않았습니다.', postUrl: null };
  }
  const connect = deps.connect || (() => defaultConnect(mcpDir));
  const blocks = buildBlocks(body, imagePaths);

  let client;
  try {
    client = await connect();
    const result = await client.callTool(
      { name: 'naver_blog_create_post', arguments: { title, blocks, tags, publish: false } },
      undefined,
      { timeout: TOOL_TIMEOUT_MS },
    );
    return parseToolResult(extractText(result));
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : '알 수 없는 오류', postUrl: null };
  } finally {
    if (client) await client.close().catch(() => {});
  }
}
```

- [ ] **Step 6: 통과 확인**

Run: `node --import ./tests/setup.mjs --test tests/naverBlog.test.js`
Expected: PASS (3 tests)

- [ ] **Step 7: 커밋**

```bash
git add src/publisher/naverBlog.js src/config.js .env.example package.json package-lock.json tests/naverBlog.test.js
git commit -m "feat(naver): MCP 클라이언트로 네이버 블로그 임시저장 모듈 추가"
```

---

### Task 3: naverJobStore.js — 인메모리 작업 상태

**Files:**
- Create: `src/publisher/naverJobStore.js`
- Test: `tests/naverJobStore.test.js`

**Interfaces:**
- Produces:
  - `createJob(id: string): void` — status `'pending'`
  - `updateJob(id, status, message?): void` — status ∈ `'pending'|'saving'|'done'|'error'`
  - `getJob(id): { id, status, message, createdAt } | undefined`

- [ ] **Step 1: 실패 테스트 작성**

`tests/naverJobStore.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJob, updateJob, getJob } from '../src/publisher/naverJobStore.js';

test('작업 생성·갱신·조회', () => {
  createJob('a1');
  assert.equal(getJob('a1').status, 'pending');
  updateJob('a1', 'saving');
  assert.equal(getJob('a1').status, 'saving');
  updateJob('a1', 'done', '임시저장 완료');
  assert.equal(getJob('a1').status, 'done');
  assert.equal(getJob('a1').message, '임시저장 완료');
});

test('없는 작업 갱신은 조용히 무시, 조회는 undefined', () => {
  updateJob('nope', 'done');
  assert.equal(getJob('nope'), undefined);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import ./tests/setup.mjs --test tests/naverJobStore.test.js`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/publisher/naverJobStore.js`:
```js
// 네이버 블로그 포스팅은 30초~2분 + CAPTCHA 수동 대응 가능성이 있어 동기 응답에 부적합하다.
// 라우트는 즉시 jobId를 돌려주고, 실제 작업은 백그라운드에서 이 저장소의 상태를 갱신한다.
// 단일 Express 프로세스이므로 모듈 스코프 Map으로 충분하다(프로세스 재시작 시 초기화됨).
const jobs = new Map();

export function createJob(id) {
  jobs.set(id, { id, status: 'pending', message: '', createdAt: Date.now() });
}

export function updateJob(id, status, message = '') {
  const job = jobs.get(id);
  if (!job) return;
  job.status = status;
  job.message = message;
}

export function getJob(id) {
  return jobs.get(id);
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import ./tests/setup.mjs --test tests/naverJobStore.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/publisher/naverJobStore.js tests/naverJobStore.test.js
git commit -m "feat(naver): 비동기 포스팅 작업 상태 인메모리 저장소 추가"
```

---

### Task 4: content.js — Gemini 블로그 본문 생성

**Files:**
- Modify: `src/generator/content.js`
- Test: `tests/content.test.js` (기존 파일에 추가)

**Interfaces:**
- Consumes: `generateText`(기존), `parseContent` 아님 — 블로그는 별도 파서.
- Produces:
  - `buildBlogPrompt(sources, cards): string` — cards.length개의 카드 이미지가 있다고 알리고 `[사진1..N]`을 자연스러운 위치에 넣게 지시.
  - `parseBlogContent(text): { blogTitle, blogBody, blogTags }` — 코드펜스 제거 후 JSON 파싱, 필드 보정.
  - `generateBlogDraft(sources, cards, genFn=generateText): Promise<{ blogTitle, blogBody, blogTags }>`

- [ ] **Step 1: 실패 테스트 작성**

`tests/content.test.js` 하단에 추가:
```js
import { buildBlogPrompt, parseBlogContent } from '../src/generator/content.js';

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
Expected: FAIL — `buildBlogPrompt`/`parseBlogContent` export 없음.

- [ ] **Step 3: 구현**

`src/generator/content.js` 하단에 추가:
```js
// 카드 스토리를 재료로 네이버 블로그 전용 본문을 생성한다. 카드 이미지 N장을 [사진1..N]
// 마커로 본문 흐름에 끼워 넣게 하고, 섹션 전환에는 [구분선], 핵심 수치 강조에는
// [인용구]...[/인용구]를 쓰게 한다(naverBlocks.buildBlocks가 이 마커들을 해석).
export function buildBlogPrompt(sources, cards) {
  const srcText = sources.map((s, i) =>
    `[소스${i + 1}] (${s.type}) ${s.title}\n${s.summary || ''}`
  ).join('\n\n');
  const cardList = cards.map((c, i) => `[사진${i + 1}] = ${c.title || `카드 ${i + 1}`}`).join('\n');

  return `너는 10년 경력의 한국 경제 블로그 에디터다. 아래 카드뉴스 스토리를, 검색해서 들어온 독자가 끝까지 읽는 네이버 블로그 글로 다시 쓴다.

## 재료 — 소스
${srcText}

## 재료 — 카드 이미지(본문에 끼워 넣을 수 있는 이미지 ${cards.length}장)
${cardList}

## 작성 규칙
- 카드 조각을 이어 붙이지 말고, 하나의 흐르는 글로 다시 쓴다(도입-전개-정리).
- 위 이미지를 자연스러운 위치에 [사진1]~[사진${cards.length}] 마커로 배치한다. 순서대로, 각 1회씩, 관련 내용 바로 아래에 둔다.
- 섹션이 바뀌는 곳에는 [구분선]을 넣는다(과하지 않게).
- 핵심 수치나 한 줄 결론은 [인용구]...[/인용구]로 감싸 강조한다(1~3회).
- 숫자는 소스와 동일하게. 과장·단정·투자 권유 금지. 쉬운 한국어.
- 제목은 검색 친화적으로(핵심 키워드 포함, 35자 이내).
- 태그는 5~10개, 핵심 키워드.

## 출력 형식(JSON만, 다른 텍스트 금지)
{"blogTitle":"...","blogBody":"...(마커 포함 본문, 문단은 개행으로 구분)...","blogTags":["...","..."]}`;
}

export function parseBlogContent(text) {
  const m = text.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/);
  const obj = JSON.parse((m ? m[1] : text).trim());
  if (!obj.blogTitle || !obj.blogBody) {
    throw new Error('생성 결과에 blogTitle/blogBody가 없습니다');
  }
  return {
    blogTitle: String(obj.blogTitle),
    blogBody: String(obj.blogBody),
    blogTags: Array.isArray(obj.blogTags) ? obj.blogTags.map(String).filter(Boolean).slice(0, 10) : [],
  };
}

export async function generateBlogDraft(sources, cards, genFn = generateText) {
  const raw = await genFn(buildBlogPrompt(sources, cards));
  return parseBlogContent(raw);
}
```
(주의: 위 정규식의 백틱은 실제 코드에서는 이스케이프 없이 ``` /```(?:json)?\s*([\s\S]*?)```/ ``` 형태로 쓴다 — 기존 `parseContent`와 동일.)

- [ ] **Step 4: 통과 확인**

Run: `node --import ./tests/setup.mjs --test tests/content.test.js`
Expected: PASS (기존 + 신규 3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/generator/content.js tests/content.test.js
git commit -m "feat(naver): Gemini 블로그 전용 본문 생성(마커 포함) 추가"
```

---

### Task 5: server.js — 라우트 3개 + DI

**Files:**
- Modify: `src/web/server.js`
- Test: `tests/server.test.js` (기존 파일에 추가)

**Interfaces:**
- Consumes: `generateBlogDraft`(Task 4), `postToNaverBlog`(Task 2), `createJob/updateJob/getJob`(Task 3), `db.getDraft`, `db.listCards`, `db.updateDraftContent`.
- Produces (HTTP):
  - `POST /api/drafts/:id/blog` → 블로그 본문 생성 후 `content.blogTitle/blogBody/blogTags` 저장, `getDraft` 반환.
  - `POST /api/drafts/:id/publish-naver` → `{ jobId }` 즉시 반환, 백그라운드 포스팅.
  - `GET /api/naver-jobs/:jobId` → `{ status, message } | 404`.
- DI 키: `deps.generateBlogDraft`, `deps.postToNaverBlog`, `deps.naverJobs = { createJob, updateJob, getJob }`.

- [ ] **Step 1: 실패 테스트 작성**

`tests/server.test.js` 하단에 추가:
```js
test('POST /api/drafts/:id/blog — 블로그 본문을 생성해 초안에 저장한다', async () => {
  const dbB = openDb(':memory:');
  const appB = createServer(dbB, {
    generateContent: async () => ({ caption: 'c', cards: [{ template: 'cover', title: 't', body: '' }], threadsText: 'th' }),
    generateBlogDraft: async () => ({ blogTitle: '블로그제목', blogBody: '본문[사진1]', blogTags: ['경제'] }),
  });
  const srvB = appB.listen(0);
  try {
    const baseB = `http://127.0.0.1:${srvB.address().port}`;
    const sid = dbB.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(baseB + '/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sid] }) });
    const draft = await r.json();
    r = await fetch(baseB + `/api/drafts/${draft.id}/blog`, { method: 'POST' });
    const updated = await r.json();
    assert.equal(r.status, 200);
    assert.equal(updated.content.blogTitle, '블로그제목');
    assert.equal(updated.content.blogBody, '본문[사진1]');
  } finally { srvB.close(); }
});

test('publish-naver → jobId 반환, 잡 완료 후 status done', async () => {
  const dbC = openDb(':memory:');
  let posted = null;
  const appC = createServer(dbC, {
    generateContent: async () => ({ caption: 'c', cards: [{ template: 'cover', title: 't', body: '' }], threadsText: 'th' }),
    postToNaverBlog: async (input) => { posted = input; return { success: true, message: '임시저장 완료', postUrl: null }; },
  });
  const srvC = appC.listen(0);
  try {
    const baseC = `http://127.0.0.1:${srvC.address().port}`;
    const sid = dbC.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(baseC + '/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sid] }) });
    const draft = await r.json();
    // 블로그 본문 세팅
    dbC.updateDraftContent(draft.id, { ...draft.content, blogTitle: 'T', blogBody: '본문', blogTags: [] });
    r = await fetch(baseC + `/api/drafts/${draft.id}/publish-naver`, { method: 'POST' });
    const { jobId } = await r.json();
    assert.ok(jobId);
    // 잡 완료까지 폴링
    let status;
    for (let i = 0; i < 50; i++) {
      const jr = await fetch(baseC + `/api/naver-jobs/${jobId}`);
      status = (await jr.json()).status;
      if (status === 'done' || status === 'error') break;
      await new Promise((res) => setTimeout(res, 20));
    }
    assert.equal(status, 'done');
    assert.equal(posted.title, 'T');
  } finally { srvC.close(); }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import ./tests/setup.mjs --test tests/server.test.js`
Expected: FAIL — 라우트 없음(404).

- [ ] **Step 3: 구현 — import/DI 배선**

`src/web/server.js` 상단 import에 추가:
```js
import { generateBlogDraft as defaultGenerateBlogDraft } from '../generator/content.js';
import { postToNaverBlog as defaultPostToNaverBlog } from '../publisher/naverBlog.js';
import * as defaultNaverJobs from '../publisher/naverJobStore.js';
```
`createServer` 상단 DI 배선에 추가:
```js
  const generateBlog = deps.generateBlogDraft || defaultGenerateBlogDraft;
  const postNaver = deps.postToNaverBlog || defaultPostToNaverBlog;
  const naverJobs = deps.naverJobs || defaultNaverJobs;
```

- [ ] **Step 4: 구현 — 라우트 3개**

`app.get('/api/posts', ...)` 위(또는 publish 라우트 근처)에 추가:
```js
  // 카드 스토리를 재료로 블로그 전용 본문을 생성해 초안에 저장(카드 이미지는 발행 때 끼워 넣음).
  app.post('/api/drafts/:id/blog', async (req, res) => {
    const d = db.getDraft(Number(req.params.id));
    if (!d?.content?.cards?.length) return res.status(400).json({ error: '카드 문구가 없습니다' });
    try {
      const sources = (d.source_ids || []).map((id) => db.getSource(id)).filter(Boolean);
      const blog = await generateBlog(sources, d.content.cards);
      db.updateDraftContent(d.id, { ...d.content, ...blog });
      res.json(db.getDraft(d.id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 네이버 블로그 임시저장을 백그라운드 작업으로 시작하고 jobId를 즉시 반환한다.
  app.post('/api/drafts/:id/publish-naver', (req, res) => {
    const d = db.getDraft(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'not found' });
    if (!d.content?.blogBody) return res.status(400).json({ error: '블로그 본문을 먼저 생성하세요' });
    const cards = db.listCards(d.id);
    const imagePaths = cards.map((c) => c.image_path);
    const jobId = randomUUID();
    naverJobs.createJob(jobId);
    // 응답을 막지 않도록 백그라운드 실행.
    (async () => {
      naverJobs.updateJob(jobId, 'saving');
      try {
        const r = await postNaver({ title: d.content.blogTitle || d.content.cards[0]?.title || '제목', body: d.content.blogBody, imagePaths, tags: d.content.blogTags || [] });
        naverJobs.updateJob(jobId, r.success ? 'done' : 'error', r.message);
      } catch (e) {
        naverJobs.updateJob(jobId, 'error', e.message);
      }
    })();
    res.json({ jobId });
  });

  app.get('/api/naver-jobs/:jobId', (req, res) => {
    const job = naverJobs.getJob(req.params.jobId);
    return job ? res.json({ status: job.status, message: job.message }) : res.status(404).json({ error: 'not found' });
  });
```
`src/web/server.js` 상단에 `randomUUID` import 추가:
```js
import { randomUUID } from 'node:crypto';
```

- [ ] **Step 5: 통과 확인**

Run: `node --import ./tests/setup.mjs --test tests/server.test.js`
Expected: PASS (기존 + 신규 2 tests)

- [ ] **Step 6: 전체 테스트**

Run: `npm test`
Expected: PASS (기존 85 + 신규 전부)

- [ ] **Step 7: 커밋**

```bash
git add src/web/server.js tests/server.test.js
git commit -m "feat(naver): 블로그 본문 생성·임시저장·작업상태 라우트 추가"
```

---

### Task 6: 대시보드 UI — 블로그 본문 생성/편집 + 네이버 임시저장

**Files:**
- Modify: `src/web/public/index.html`
- Modify: `src/web/public/app.js`
- Modify: `src/web/public/style.css`

**Interfaces:**
- Consumes (HTTP): `POST /api/drafts/:id/blog`, `POST /api/drafts/:id/publish-naver`, `GET /api/naver-jobs/:jobId`.

- [ ] **Step 1: index.html — 초안 상세에 블로그 섹션 추가**

`#draft-detail`의 카드 미리보기(`#card-preview`) 다음, 배포 툴바 근처에 추가:
```html
      <h2>네이버 블로그</h2>
      <div class="toolbar">
        <button id="btn-gen-blog">📝 블로그 본문 생성</button>
        <button id="btn-publish-naver" class="primary">📗 네이버 블로그 임시저장</button>
      </div>
      <input id="ed-blog-title" placeholder="블로그 제목">
      <textarea id="ed-blog-body" rows="12" placeholder="블로그 본문 ([사진1] 위치에 카드 이미지가 삽입됩니다)"></textarea>
      <div id="naver-result"></div>
```

- [ ] **Step 2: app.js — 렌더링에 블로그 필드 반영**

`renderDraftDetail()` 안(캡션/스레드 세팅 근처)에 추가:
```js
  $('#ed-blog-title').value = d.content?.blogTitle || '';
  $('#ed-blog-body').value = d.content?.blogBody || '';
```
`collectEditedContent()`의 반환 객체에 블로그 필드 병합:
```js
  return { ...currentDraft.content, caption: $('#ed-caption').value, threadsText: $('#ed-threads').value,
    blogTitle: $('#ed-blog-title').value, blogBody: $('#ed-blog-body').value };
```

- [ ] **Step 3: app.js — 버튼 핸들러 추가**

`app.js` 하단(발행 핸들러 근처)에 추가:
```js
$('#btn-gen-blog').addEventListener('click', async (e) => {
  busy(e.target, true, 'Gemini 블로그 본문 생성 중…');
  try {
    currentDraft = await api(`/api/drafts/${currentDraft.id}/blog`, { method: 'POST' });
    renderDraftDetail();
    await renderCardPreview();
    toast('블로그 본문이 생성되었습니다. 검토 후 임시저장하세요.');
  } catch (err) { toast(err.message, true); }
  finally { busy(e.target, false); }
});

$('#btn-publish-naver').addEventListener('click', async (e) => {
  // 편집한 본문을 먼저 저장한 뒤 포스팅.
  await api(`/api/drafts/${currentDraft.id}/content`, { method: 'PUT', body: { content: collectEditedContent() } });
  busy(e.target, true, '네이버 임시저장 중… (CAPTCHA가 뜨면 열린 브라우저에서 풀어주세요)');
  const out = $('#naver-result');
  out.textContent = '';
  try {
    const { jobId } = await api(`/api/drafts/${currentDraft.id}/publish-naver`, { method: 'POST' });
    // 상태 폴링(최대 3분).
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const job = await api(`/api/naver-jobs/${jobId}`);
      out.textContent = `상태: ${job.status}${job.message ? ' — ' + job.message : ''}`;
      if (job.status === 'done') { toast('네이버 블로그에 임시저장되었습니다'); break; }
      if (job.status === 'error') { toast(job.message || '임시저장 실패', true); break; }
    }
  } catch (err) { toast(err.message, true); out.textContent = err.message; }
  finally { busy(e.target, false); }
});
```

- [ ] **Step 4: style.css — 결과 영역 여백(선택)**

`#publish-result` 규칙 근처에 추가:
```css
#naver-result { margin: 10px 0; color: #9fb0c0; line-height: 1.7; white-space: pre-wrap; }
#ed-blog-title, #ed-blog-body { margin-top: 8px; }
```

- [ ] **Step 5: 수동 확인 — 렌더링/버튼 존재**

`npm start` 후 브라우저 대신 서버 라우트 정적 제공만 확인(실제 네이버 발행은 Task 7). 초안 상세에 블로그 제목/본문 입력칸과 두 버튼이 보이면 OK.

- [ ] **Step 6: 커밋**

```bash
git add src/web/public/index.html src/web/public/app.js src/web/public/style.css
git commit -m "feat(naver): 대시보드에 블로그 본문 생성·편집·임시저장 UI 추가"
```

---

### Task 7: 엔드투엔드 수동 검증 (실계정)

**Files:** 없음 (검증만)

**전제 조건 (사용자 환경):**
- `naver-blog-mcp` 폴더의 `.env`에 `NAVER_BLOG_ID`/`NAVER_BLOG_PASSWORD` 설정됨.
- 우리 앱 `.env`에 `NAVER_BLOG_MCP_DIR=C:\Users\jzzz7\Desktop\AI\naver-blog-mcp`.
- 최초 실행 시 CAPTCHA/로그인은 `HEADLESS=false`(MCP 쪽 .env)로 열린 브라우저에서 직접 처리 후 세션 저장됨.

- [ ] **Step 1:** 스토리 초안 하나를 골라 카드 이미지까지 생성된 상태로 준비.
- [ ] **Step 2:** "📝 블로그 본문 생성" → 본문에 `[사진1..N]`/`[구분선]`/`[인용구]`가 들어갔는지, 내용이 자연스러운지 검토·수정.
- [ ] **Step 3:** "📗 네이버 블로그 임시저장" → 상태가 `saving`→`done`으로 가는지 확인. CAPTCHA가 뜨면 열린 브라우저에서 해결.
- [ ] **Step 4:** 네이버 블로그 "내 글 관리 > 저장 글"에서 제목·본문·카드 이미지·구분선·인용구가 올바른 순서로 들어갔는지 확인.
- [ ] **Step 5:** 결과를 사용자에게 보고. 기존 Instagram/Threads 배포가 그대로 동작하는지도 함께 확인(회귀 없음).

---

## 향후 (이 계획 범위 밖)

- **Phase 2 — 티스토리:** 티스토리는 마크다운 에디터를 지원해 네이버보다 자동화가 단순. `buildBlocks` 대신 본문 마커→마크다운 변환 + 티스토리 에디터 Playwright 자동화(별도 모듈). 네이버 안정화 후 착수.
- **Phase 3 — 쇼츠:** 별도 설계.

## Self-Review

- **Spec 커버리지:** 네이버 블로그 자동화(재사용 MCP)=Task 1~3·5·7, Gemini 블로그 본문=Task 4, 대시보드 UI=Task 6, 기존 무손상=Global Constraints + 각 Task가 추가만 함. 티스토리/쇼츠=범위 밖 명시. ✅
- **Placeholder 스캔:** 모든 코드 스텝에 실제 코드 포함. Task 4 정규식 백틱 주의 노트 명시. ✅
- **타입 일관성:** `buildBlocks(body, imagePaths)`(T1) → `naverBlog.postToNaverBlog`(T2)에서 동일 시그니처 사용. `{success,message,postUrl}` 반환형이 T2·T5에서 일치. `naverJobs.{createJob,updateJob,getJob}`(T3) → T5에서 동일 이름 사용. `generateBlogDraft(sources, cards, genFn)`(T4) → T5 라우트에서 `generateBlog(sources, d.content.cards)`로 호출(일치). ✅
