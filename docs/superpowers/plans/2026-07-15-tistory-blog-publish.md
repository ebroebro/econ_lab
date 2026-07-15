# 티스토리 블로그 배포 (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존에 생성한 블로그 본문(네이버용 `blogTitle`/`blogBody`/`blogTags`, 마커 포함)을 카드 이미지와 함께 티스토리 블로그에 임시저장까지 자동화한다.

**Architecture:** 순수 추가형. 기존 Instagram/Threads/네이버 배포 경로는 손대지 않고, 배포 단계에 "티스토리" 출구를 하나 더 붙인다. 외부 프로젝트 `Viruagent`(Node/CommonJS, https://github.com/greekr4/Viruagent)를 **절대 수정하지 않고** clone해, 로그인 세션 쿠키로 티스토리 비공식 내부 API를 호출하는 `src/lib/tistory.js`를 `createRequire`로 직접 require해서 쓴다(네이버처럼 별도 프로세스 spawn 불필요 — 순수 CommonJS 라이브러리). 마커→블록 변환은 기존 `naverBlocks.js`의 `buildBlocks`를 재사용하고, 블록→HTML 변환만 새로 만든다. 항상 임시저장만 하며(네이버와 동일한 안전 정책), HTTP 기반이라 CAPTCHA 대기가 없어 동기 응답으로 처리한다.

**Tech Stack:** Node ESM(기존 프로젝트), `node:module`의 `createRequire`(신규 사용, 새 의존성 불필요), node:test, Express 5. 외부: `Viruagent`(Node CommonJS + Playwright, **사용자가 별도로 clone·설정**).

## Global Constraints

- **`Viruagent` 프로젝트는 절대 수정하지 않는다** — `createRequire`로 `src/lib/tistory.js`만 그대로 require한다.
- **기존 Instagram/Threads/네이버 배포 경로(`publisher/instagram.js`, `threads.js`, `naverBlog.js`, 관련 라우트)를 변경하지 않는다.**
- 티스토리 발행은 **항상 임시저장**(`saveDraft`). 최종 공개 발행은 사용자가 티스토리 에디터에서 직접.
- 새 배포 모듈은 기존 publisher처럼 **의존성 주입(DI)**으로 테스트 가능하게 만든다(실제 `Viruagent` 라이브러리 호출을 목으로 대체 가능).
- 티스토리 전용 콘텐츠 생성 프롬프트는 만들지 않는다 — 기존 "📝 블로그 본문 생성"(네이버용) 결과를 그대로 재사용한다.
- 테스트는 기존 방식 유지: `node --import ./tests/setup.mjs --test "tests/*.test.js"`.
- Node ESM(`import`), 파일 상단 한글 주석은 "왜"를 설명(기존 코드 스타일 준수).
- 티스토리 계정 정보는 우리 앱이 절대 보관/전달하지 않는다 — `Viruagent`가 자기 `data/session.json`으로 처리한다.

---

## File Structure

- **Create `src/publisher/tistoryBlocks.js`** — `buildBlocks`(재사용)가 만든 블록 배열 + 이미지 업로드 함수 → 티스토리 HTML 문자열. 이미지 블록만 IO(파일 읽기 + 업로드) 발생, 나머지는 순수 변환.
- **Create `src/publisher/tistory.js`** — `Viruagent`의 `src/lib/tistory.js`를 `createRequire`로 로드해 `initBlog()`→`buildBlocks()`→`renderBlocksToHtml()`→`saveDraft()` 순서로 오케스트레이션. DI로 `lib`/`viruagentDir` 주입 가능.
- **Modify `src/config.js`** — `tistoryViruagentDir` 추가.
- **Modify `.env.example`** — `TISTORY_VIRUAGENT_DIR` 추가.
- **Modify `src/web/server.js`** — 라우트 1개 추가(`POST /api/drafts/:id/publish-tistory`, 동기 응답) + DI 배선.
- **Modify `src/web/public/index.html` / `app.js` / `style.css`** — 초안 상세에 "티스토리 임시저장" 버튼 + 결과 표시 UI(생성 버튼·본문 편집칸은 네이버와 공유).
- **Tests:** `tests/tistoryBlocks.test.js`, `tests/tistory.test.js`, `tests/server.test.js`(라우트 추가).

---

### Task 1: tistoryBlocks.js — 블록 → 티스토리 HTML 변환

**Files:**
- Create: `src/publisher/tistoryBlocks.js`
- Test: `tests/tistoryBlocks.test.js`

**Interfaces:**
- Consumes: `buildBlocks(body, imagePaths)`의 출력 형태 — `Block = { type:'text', text } | { type:'image', path } | { type:'divider' } | { type:'quote', text }` (이미 `src/publisher/naverBlocks.js`에 존재, 이 태스크에서는 import하지 않고 블록 배열을 직접 받기만 함).
- Produces:
  - `renderBlocksToHtml(blocks: Block[], deps: { uploadImage: (buffer: Buffer, filename: string) => Promise<{ url: string }> }): Promise<{ html: string, thumbnailKage: string|null, warnings: string[] }>`
    - `text` → `<p>...</p>`(줄바꿈은 `<br>`로 보존, HTML 특수문자 이스케이프)
    - `divider` → `<hr>`
    - `quote` → `<blockquote><p>...</p></blockquote>`
    - `image` → 로컬 파일을 읽어 `uploadImage(buffer, filename)` 호출. 응답 `url`에서 `/dna/(.+)`를 추출해 `kage@...`로 만들고 `<p>[##_Image|kage@...|CDM|1.3|{"originWidth":0,"originHeight":0,"style":"alignCenter"}_##]</p>`로 치환. 첫 성공 이미지의 kagePath를 `thumbnailKage`로 반환. 업로드 실패(예외 또는 `/dna/` 패턴 없음)는 해당 이미지만 건너뛰고 `warnings`에 메시지 추가.

- [ ] **Step 1: 실패 테스트 작성**

`tests/tistoryBlocks.test.js`:
```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderBlocksToHtml } from '../src/publisher/tistoryBlocks.js';

let tmpDir;
let imgPath;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tistory-blocks-'));
  imgPath = path.join(tmpDir, 'card-1.png');
  fs.writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG 시그니처만 있으면 충분
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('text 블록은 <p>로, 줄바꿈은 <br>로 변환된다', async () => {
  const { html } = await renderBlocksToHtml([{ type: 'text', text: '첫줄\n둘째줄' }], { uploadImage: async () => ({ url: '' }) });
  assert.equal(html, '<p>첫줄<br>둘째줄</p>');
});

test('divider 블록은 <hr>, quote 블록은 blockquote로 변환된다', async () => {
  const { html } = await renderBlocksToHtml(
    [{ type: 'divider' }, { type: 'quote', text: '핵심 수치' }],
    { uploadImage: async () => ({ url: '' }) },
  );
  assert.equal(html, '<hr>\n<blockquote><p>핵심 수치</p></blockquote>');
});

test('image 블록은 업로드 후 kage@ 치환자로 변환되고 첫 이미지가 thumbnailKage가 된다', async () => {
  const calls = [];
  const { html, thumbnailKage, warnings } = await renderBlocksToHtml(
    [{ type: 'image', path: imgPath }],
    { uploadImage: async (buffer, filename) => { calls.push(filename); return { url: 'https://t1.daumcdn.net/tistory_admin/dna/AbCdEf123' }; } },
  );
  assert.deepEqual(calls, ['card-1.png']);
  assert.equal(html, '<p>[##_Image|kage@AbCdEf123|CDM|1.3|{"originWidth":0,"originHeight":0,"style":"alignCenter"}_##]</p>');
  assert.equal(thumbnailKage, 'kage@AbCdEf123');
  assert.deepEqual(warnings, []);
});

test('이미지 업로드가 실패하면 해당 이미지만 건너뛰고 warnings에 기록한다', async () => {
  const { html, thumbnailKage, warnings } = await renderBlocksToHtml(
    [{ type: 'text', text: '앞' }, { type: 'image', path: imgPath }, { type: 'text', text: '뒤' }],
    { uploadImage: async () => { throw new Error('업로드 500'); } },
  );
  assert.equal(html, '<p>앞</p>\n<p>뒤</p>');
  assert.equal(thumbnailKage, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /card-1\.png/);
  assert.match(warnings[0], /업로드 500/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import ./tests/setup.mjs --test tests/tistoryBlocks.test.js`
Expected: FAIL — `Cannot find module '../src/publisher/tistoryBlocks.js'`

- [ ] **Step 3: 구현**

`src/publisher/tistoryBlocks.js`:
```js
// naverBlocks.buildBlocks가 만든 블록(text/image/divider/quote)을 티스토리 임시저장용 HTML로
// 렌더링한다. 이미지 블록만 실제 업로드(IO)가 필요하고 나머지는 순수 문자열 변환이다.
import fs from 'node:fs';
import path from 'node:path';

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function textToHtml(text) {
  return `<p>${escapeHtml(text).split('\n').join('<br>')}</p>`;
}

async function imageToHtml(block, uploadImage, warnings) {
  const filename = path.basename(block.path);
  try {
    const buffer = fs.readFileSync(block.path);
    const uploaded = await uploadImage(buffer, filename);
    const dnaMatch = uploaded?.url?.match(/\/dna\/(.+)/);
    if (!dnaMatch) throw new Error('업로드 응답에 dna 경로가 없습니다');
    const kagePath = `kage@${dnaMatch[1]}`;
    const html = `<p>[##_Image|${kagePath}|CDM|1.3|{"originWidth":0,"originHeight":0,"style":"alignCenter"}_##]</p>`;
    return { html, kagePath };
  } catch (e) {
    warnings.push(`이미지 업로드 실패(${filename}): ${e.message}`);
    return null;
  }
}

export async function renderBlocksToHtml(blocks, { uploadImage }) {
  const parts = [];
  const warnings = [];
  let thumbnailKage = null;

  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push(textToHtml(block.text));
    } else if (block.type === 'divider') {
      parts.push('<hr>');
    } else if (block.type === 'quote') {
      parts.push(`<blockquote><p>${escapeHtml(block.text)}</p></blockquote>`);
    } else if (block.type === 'image') {
      const result = await imageToHtml(block, uploadImage, warnings);
      if (result) {
        parts.push(result.html);
        if (!thumbnailKage) thumbnailKage = result.kagePath;
      }
    }
  }

  return { html: parts.join('\n'), thumbnailKage, warnings };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import ./tests/setup.mjs --test tests/tistoryBlocks.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/publisher/tistoryBlocks.js tests/tistoryBlocks.test.js
git commit -m "feat(tistory): 블록 → 티스토리 HTML 변환 모듈 추가"
```

---

### Task 2: tistory.js — Viruagent 라이브러리로 임시저장

**Files:**
- Create: `src/publisher/tistory.js`
- Modify: `src/config.js` (`tistoryViruagentDir`)
- Modify: `.env.example`
- Test: `tests/tistory.test.js`

**Interfaces:**
- Consumes: `buildBlocks`(`src/publisher/naverBlocks.js`, 기존), `renderBlocksToHtml`(Task 1).
- Produces:
  - `postToTistory({ title, body, imagePaths, tags }, deps?): Promise<{ success: boolean, message: string, postUrl: string|null }>`
    - `deps.viruagentDir`(기본 `config.tistoryViruagentDir`), `deps.lib`(기본: 실제 `Viruagent`의 `src/lib/tistory.js`를 `createRequire`로 require; 테스트는 `{ initBlog, saveDraft, uploadImage }` 형태의 목 주입).

- [ ] **Step 1: config에 viruagentDir 추가**

`src/config.js`의 `export const config = {` 블록, `naverBlogMcpDir` 줄 바로 아래에 추가:
```js
  tistoryViruagentDir: process.env.TISTORY_VIRUAGENT_DIR || '',
```

`.env.example`의 `NAVER_BLOG_MCP_DIR=` 줄 아래에 추가:
```
# 티스토리 자동화(Viruagent, https://github.com/greekr4/Viruagent) 폴더 경로.
# 최초 1회 해당 폴더에서 `node src/lib/login.js`를 직접 실행해 로그인(data/session.json 생성) 필요.
TISTORY_VIRUAGENT_DIR=
```

- [ ] **Step 2: 실패 테스트 작성**

`tests/tistory.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postToTistory } from '../src/publisher/tistory.js';

function fakeLib({ saveDraftResult, initBlogError } = {}) {
  const calls = [];
  return {
    calls,
    lib: {
      async initBlog() {
        calls.push('initBlog');
        if (initBlogError) throw new Error(initBlogError);
      },
      async uploadImage(buffer, filename) {
        calls.push({ uploadImage: filename });
        return { url: 'https://t1.daumcdn.net/tistory_admin/dna/Xyz789' };
      },
      async saveDraft({ title, content }) {
        calls.push({ saveDraft: { title, content } });
        return saveDraftResult ?? { draft: { sequence: 42 } };
      },
    },
  };
}

test('postToTistory는 initBlog → buildBlocks → 이미지 업로드 → saveDraft 순서로 호출한다', async () => {
  const { lib, calls } = fakeLib();
  const res = await postToTistory(
    { title: '제목', body: '문단\n[사진1]', imagePaths: ['/img/1.png'], tags: ['경제'] },
    { viruagentDir: '/x', lib },
  );
  assert.equal(res.success, true);
  assert.match(res.message, /42/);
  assert.deepEqual(calls[0], 'initBlog');
  assert.deepEqual(calls[1], { uploadImage: '1.png' });
  const draftCall = calls[2].saveDraft;
  assert.equal(draftCall.title, '제목');
  assert.match(draftCall.content, /kage@Xyz789/);
});

test('viruagentDir 미설정이면 success:false로 안내한다', async () => {
  const res = await postToTistory({ title: 't', body: 'b', imagePaths: [], tags: [] }, { viruagentDir: '' });
  assert.equal(res.success, false);
  assert.match(res.message, /TISTORY_VIRUAGENT_DIR/);
});

test('세션 만료 등 initBlog 실패는 success:false로 감싼다', async () => {
  const { lib } = fakeLib({ initBlogError: '세션이 만료되었습니다. /login으로 다시 로그인하세요.' });
  const res = await postToTistory({ title: 't', body: 'b', imagePaths: [], tags: [] }, { viruagentDir: '/x', lib });
  assert.equal(res.success, false);
  assert.match(res.message, /세션이 만료/);
});

test('이미지 업로드 경고가 있으면 메시지에 포함되지만 success는 true다', async () => {
  const { lib } = fakeLib();
  lib.uploadImage = async () => { throw new Error('업로드 500'); };
  const res = await postToTistory(
    { title: '제목', body: '문단\n[사진1]', imagePaths: ['/img/1.png'], tags: [] },
    { viruagentDir: '/x', lib },
  );
  assert.equal(res.success, true);
  assert.match(res.message, /업로드 500/);
});
```

- [ ] **Step 3: 실패 확인**

Run: `node --import ./tests/setup.mjs --test tests/tistory.test.js`
Expected: FAIL — 모듈 없음.

- [ ] **Step 4: 구현**

`src/publisher/tistory.js`:
```js
// Viruagent(https://github.com/greekr4/Viruagent)의 src/lib/tistory.js를 그대로 require해
// 로그인 세션 쿠키로 티스토리 비공식 내부 API를 호출한다. 이 프로젝트는 절대 수정하지 않는다.
import { createRequire } from 'node:module';
import { config } from '../config.js';
import { buildBlocks } from './naverBlocks.js';
import { renderBlocksToHtml } from './tistoryBlocks.js';

function loadDefaultLib(viruagentDir) {
  const require = createRequire(import.meta.url);
  return require(`${viruagentDir}/src/lib/tistory.js`);
}

export async function postToTistory({ title, body, imagePaths = [], tags = [] }, deps = {}) {
  const viruagentDir = deps.viruagentDir ?? config.tistoryViruagentDir;
  if (!viruagentDir) {
    return { success: false, message: 'TISTORY_VIRUAGENT_DIR 환경변수가 설정되지 않았습니다.', postUrl: null };
  }
  void tags; // Viruagent의 saveDraft는 태그를 지원하지 않는다(사용자가 티스토리 에디터에서 직접 지정).

  try {
    const lib = deps.lib || loadDefaultLib(viruagentDir);
    await lib.initBlog();
    const blocks = buildBlocks(body, imagePaths);
    const { html, warnings } = await renderBlocksToHtml(blocks, { uploadImage: lib.uploadImage });
    const result = await lib.saveDraft({ title, content: html });
    const sequence = result?.draft?.sequence;
    const base = `임시저장 완료(sequence: ${sequence})`;
    const message = warnings.length ? `${base}. 경고: ${warnings.join('; ')}` : base;
    return { success: true, message, postUrl: null };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : '알 수 없는 오류', postUrl: null };
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `node --import ./tests/setup.mjs --test tests/tistory.test.js`
Expected: PASS (4 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/publisher/tistory.js src/config.js .env.example tests/tistory.test.js
git commit -m "feat(tistory): Viruagent 재사용해 티스토리 임시저장 모듈 추가"
```

---

### Task 3: server.js — 라우트 추가 + DI

**Files:**
- Modify: `src/web/server.js`
- Test: `tests/server.test.js` (기존 파일에 추가)

**Interfaces:**
- Consumes: `postToTistory`(Task 2), `db.getDraft`, `db.listCards`.
- Produces (HTTP): `POST /api/drafts/:id/publish-tistory` → `{ success, message, postUrl }`를 동기로 반환(잡스토어 없음).
- DI 키: `deps.postToTistory`.

- [ ] **Step 1: 실패 테스트 작성**

`tests/server.test.js` 맨 아래(마지막 `publish-naver — 블로그 본문 없으면 400` 테스트 다음)에 추가:
```js

test('POST /api/drafts/:id/publish-tistory — 블로그 본문을 임시저장하고 결과를 반환한다', async () => {
  const dbE = openDb(':memory:');
  let posted = null;
  const appE = createServer(dbE, {
    generateContent: async () => ({ caption: 'c', cards: [{ template: 'cover', title: 't', body: '' }], threadsText: 'th' }),
    postToTistory: async (input) => { posted = input; return { success: true, message: '임시저장 완료(sequence: 1)', postUrl: null }; },
  });
  const srvE = appE.listen(0);
  try {
    const baseE = `http://127.0.0.1:${srvE.address().port}`;
    const sid = dbE.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(baseE + '/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sid] }) });
    const draft = await r.json();
    dbE.updateDraftContent(draft.id, { ...draft.content, blogTitle: 'T', blogBody: '본문', blogTags: ['경제'] });
    r = await fetch(baseE + `/api/drafts/${draft.id}/publish-tistory`, { method: 'POST' });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.success, true);
    assert.equal(posted.title, 'T');
    assert.equal(posted.body, '본문');
    assert.deepEqual(posted.tags, ['경제']);
  } finally { srvE.close(); }
});

test('publish-tistory — 블로그 본문 없으면 400', async () => {
  const dbF = openDb(':memory:');
  const appF = createServer(dbF, {
    generateContent: async () => ({ caption: 'c', cards: [{ template: 'cover', title: 't', body: '' }], threadsText: 'th' }),
  });
  const srvF = appF.listen(0);
  try {
    const baseF = `http://127.0.0.1:${srvF.address().port}`;
    const sid = dbF.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(baseF + '/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceIds: [sid] }) });
    const draft = await r.json();
    r = await fetch(baseF + `/api/drafts/${draft.id}/publish-tistory`, { method: 'POST' });
    assert.equal(r.status, 400);
  } finally { srvF.close(); }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import ./tests/setup.mjs --test tests/server.test.js`
Expected: FAIL — 라우트 없음(404).

- [ ] **Step 3: 구현 — import/DI 배선**

`src/web/server.js`의 기존 import 블록(16번째 줄 `import { postToNaverBlog as defaultPostToNaverBlog } from '../publisher/naverBlog.js';` 바로 아래)에 추가:
```js
import { postToTistory as defaultPostToTistory } from '../publisher/tistory.js';
```

`createServer` 상단 DI 배선(`const naverJobs = deps.naverJobs || defaultNaverJobs;` 바로 아래)에 추가:
```js
  const postTistory = deps.postToTistory || defaultPostToTistory;
```

- [ ] **Step 4: 구현 — 라우트 추가**

`app.get('/api/naver-jobs/:jobId', ...)` 블록과 `app.get('/api/posts', ...)` 사이에 추가:
```js

  // 티스토리는 HTTP 기반이라 CAPTCHA 대기가 없어 네이버와 달리 동기로 바로 결과를 반환한다.
  app.post('/api/drafts/:id/publish-tistory', async (req, res) => {
    const d = db.getDraft(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'not found' });
    if (!d.content?.blogBody) return res.status(400).json({ error: '블로그 본문을 먼저 생성하세요' });
    const cards = db.listCards(d.id);
    const imagePaths = cards.map((c) => c.image_path);
    try {
      const result = await postTistory({
        title: d.content.blogTitle || d.content.cards[0]?.title || '제목',
        body: d.content.blogBody,
        imagePaths,
        tags: d.content.blogTags || [],
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
```

- [ ] **Step 5: 통과 확인**

Run: `node --import ./tests/setup.mjs --test tests/server.test.js`
Expected: PASS (기존 + 신규 2 tests)

- [ ] **Step 6: 전체 테스트**

Run: `npm test`
Expected: PASS (전부)

- [ ] **Step 7: 커밋**

```bash
git add src/web/server.js tests/server.test.js
git commit -m "feat(tistory): 티스토리 임시저장 라우트 추가"
```

---

### Task 4: 대시보드 UI — 티스토리 임시저장 버튼

**Files:**
- Modify: `src/web/public/index.html`
- Modify: `src/web/public/app.js`
- Modify: `src/web/public/style.css`

**Interfaces:**
- Consumes (HTTP): `POST /api/drafts/:id/publish-tistory`.

- [ ] **Step 1: index.html — 네이버 섹션 옆에 티스토리 섹션 추가**

`src/web/public/index.html`의 `<div id="naver-result"></div>` 바로 아래(네이버 섹션 마지막 줄)에 추가:
```html
      <h2>티스토리</h2>
      <div class="toolbar">
        <button id="btn-publish-tistory" class="primary">🟠 티스토리 임시저장</button>
      </div>
      <div id="tistory-result"></div>
```

- [ ] **Step 2: app.js — renderDraftDetail에서 결과 영역 초기화**

`src/web/public/app.js`의 `$('#naver-result').innerHTML = '';` 줄(약 345번째 줄) 바로 아래에 추가:
```js
  $('#tistory-result').innerHTML = '';
```

(제목/본문 편집칸은 네이버와 공유하므로 별도 렌더링 불필요 — 이미 `#ed-blog-title`/`#ed-blog-body`에 채워져 있음.)

- [ ] **Step 3: app.js — 버튼 핸들러 추가**

`src/web/public/app.js`의 `$('#btn-publish-naver').addEventListener(...)` 핸들러 블록 바로 다음(약 536번째 줄 이후)에 추가:
```js

$('#btn-publish-tistory').addEventListener('click', async (e) => {
  if (!$('#ed-blog-body').value.trim()) return toast('블로그 본문을 먼저 생성하세요', true);
  // 편집한 본문을 먼저 저장한 뒤 포스팅.
  await api(`/api/drafts/${currentDraft.id}/content`, { method: 'PUT', body: { content: collectEditedContent() } });
  busy(e.target, true, '티스토리 임시저장 중…');
  const out = $('#tistory-result');
  out.textContent = '';
  try {
    const result = await api(`/api/drafts/${currentDraft.id}/publish-tistory`, { method: 'POST' });
    out.textContent = result.message || (result.success ? '임시저장 완료' : '임시저장 실패');
    if (result.success) toast('티스토리에 임시저장되었습니다');
    else toast(result.message || '임시저장 실패', true);
  } catch (err) { toast(err.message, true); out.textContent = err.message; }
  finally { busy(e.target, false); }
});
```

- [ ] **Step 4: style.css — 결과 영역 스타일**

`src/web/public/style.css`의 `#naver-result { ... }` 규칙 바로 아래에 추가:
```css
#tistory-result { margin: 10px 0; color: #9fb0c0; line-height: 1.7; white-space: pre-wrap; }
```

- [ ] **Step 5: 수동 확인 — 렌더링/버튼 존재**

`npm start` 후 브라우저에서 초안 상세로 이동해 "티스토리" 섹션과 "🟠 티스토리 임시저장" 버튼, `#tistory-result` 영역이 보이는지 확인(실제 임시저장 성공 여부는 Task 5에서 실계정으로 검증).

- [ ] **Step 6: 커밋**

```bash
git add src/web/public/index.html src/web/public/app.js src/web/public/style.css
git commit -m "feat(tistory): 대시보드에 티스토리 임시저장 UI 추가"
```

---

### Task 5: 외부 설정 + 엔드투엔드 수동 검증 (실계정, 사용자 몫)

**Files:** 없음 (외부 프로젝트 설정 + 검증만)

이 태스크는 **사용자가 직접 수행**한다. `Viruagent`는 우리 저장소 밖의 제3자 프로젝트이고, 그 저장소를 clone하고 실행하는 것(특히 최초 로그인 시 자신의 티스토리 계정으로 실제 로그인)은 사용자 본인 계정으로 하는 행동이라 에이전트가 대신 실행하지 않는다.

**전제 조건 (사용자 환경):**
- [ ] **Step 1:** `C:\Users\jzzz7\Desktop\AI` 아래에 `Viruagent`를 clone한다.
  ```bash
  git clone https://github.com/greekr4/Viruagent.git C:\Users\jzzz7\Desktop\AI\Viruagent
  cd C:\Users\jzzz7\Desktop\AI\Viruagent
  npm install
  ```
- [ ] **Step 2:** 최초 1회 로그인 세션을 만든다.
  ```bash
  node src/lib/login.js
  ```
  브라우저 창이 뜨면 티스토리 계정으로 직접 로그인 → 터미널에서 Enter → `Viruagent/data/session.json` 생성 확인.
- [ ] **Step 3:** 우리 앱의 `.env`에 추가.
  ```
  TISTORY_VIRUAGENT_DIR=C:\Users\jzzz7\Desktop\AI\Viruagent
  ```
- [ ] **Step 4:** 앱을 재시작하고, 카드 이미지까지 생성된 초안에서 "📝 블로그 본문 생성"(이미 있다면 생략) → "🟠 티스토리 임시저장" 클릭.
- [ ] **Step 5:** 결과 메시지에 `success: true`와 `sequence` 번호가 뜨는지 확인. 티스토리 "글 관리 > 임시글"에서 제목·본문·이미지·구분선·인용구가 순서대로 들어갔는지 확인.
- [ ] **Step 6:** 세션 만료 시나리오도 확인 — `Viruagent/data/session.json`을 임시로 이름 변경 후 재시도하면 "세션이 만료되었습니다..." 메시지가 뜨는지 확인, 원래 이름으로 복구.
- [ ] **Step 7:** 결과를 보고. 기존 Instagram/Threads/네이버 배포가 그대로 동작하는지도 함께 확인(회귀 없음).

---

## Self-Review

- **Spec 커버리지:** 아키텍처(Viruagent 직접 require, 최초 1회 수동 로그인, 콘텐츠/블록 변환 재사용, 항상 임시저장, 동기 응답)=Task 1~3, UI=Task 4, 외부 설정/검증=Task 5. 범위 밖(공개 발행 자동화, 전용 생성 프롬프트, 카테고리)은 Task 2 구현에서 `tags` 미사용으로 명시하고 계획에도 언급. ✅
- **Placeholder 스캔:** 모든 코드 스텝에 실제 코드 포함. "TBD"/"TODO" 없음. ✅
- **타입 일관성:** `renderBlocksToHtml(blocks, { uploadImage })`(T1) → `postToTistory`가 `lib.uploadImage`를 그대로 전달(T2)해 동일 시그니처. `postToTistory({title,body,imagePaths,tags}, deps)`(T2)와 반환 타입 `{success,message,postUrl}`이 네이버(`postToNaverBlog`)와 동일해 라우트(T3)·UI(T4)에서 같은 패턴으로 처리. 라우트 DI 키 `deps.postToTistory`(T3)가 `tests/server.test.js`(T3)에서 동일 이름으로 주입됨. ✅
