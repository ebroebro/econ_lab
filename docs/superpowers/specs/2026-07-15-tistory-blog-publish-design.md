# 티스토리 블로그 배포 (Phase 2) 설계

**목표:** 기존 카드뉴스 초안에서 이미 생성한 블로그 본문(네이버용으로 만든 `blogTitle`/`blogBody`/`blogTags`, 마커 포함)을, 카드 이미지와 함께 티스토리 블로그에 임시저장까지 자동화한다.

**배경:** [2026-07-14-naver-blog-publish 계획](../plans/2026-07-14-naver-blog-publish.md)의 "향후 — Phase 2: 티스토리"를 구체화한 것. 네이버는 별도 Python MCP(`naver-blog-mcp`)를 stdio로 spawn해 재사용했지만, 티스토리는 그런 기존 프로젝트가 없어 사용자가 지정한 외부 프로젝트 [`Viruagent`](https://github.com/greekr4/Viruagent)(Node/CommonJS)를 clone해 재사용한다.

## 아키텍처

순수 추가형. 기존 Instagram/Threads/네이버 배포 경로는 손대지 않고, 배포 단계에 "티스토리" 출구를 하나 더 붙인다.

- **외부 프로젝트 재사용:** `Viruagent`를 `C:\Users\jzzz7\Desktop\AI\Viruagent`에 clone하고 **절대 수정하지 않는다**. 이 프로젝트는 MCP 서버가 아니라 로그인 세션 쿠키로 티스토리 비공식 내부 API(`fetch`)를 호출하는 순수 CommonJS 라이브러리(`src/lib/tistory.js`)라서, 별도 프로세스 spawn 없이 `createRequire`로 **직접 require**해서 쓴다.
- **최초 1회 수동 로그인:** 사용자가 `Viruagent` 폴더에서 `node src/lib/login.js`를 직접 실행 → Playwright 창에서 로그인 → Enter → `Viruagent/data/session.json`에 쿠키 저장. 이후 우리 앱은 이 세션 파일을 그대로 읽는다(경로는 `Viruagent`의 `tistory.js`가 자기 `__dirname` 기준으로 알아서 찾음 — 우리가 신경 쓸 필요 없음). 세션 만료 시 에러 메시지로 재로그인을 안내한다.
- **콘텐츠 재사용:** 티스토리 전용 생성 로직을 만들지 않는다. 이미 있는 "📝 블로그 본문 생성"(Gemini) 결과(`blogTitle`/`blogBody`/`blogTags`, `[사진N]`/`[구분선]`/`[인용구]` 마커)를 네이버·티스토리 둘 다에서 그대로 쓴다.
- **블록 변환 재사용:** 마커 → 블록 변환은 기존 `src/publisher/naverBlocks.js`의 `buildBlocks(body, imagePaths)`를 그대로 재사용한다(플랫폼 무관 순수 함수). 새 파서를 만들지 않는다.
- **HTML 렌더링(신규):** 블록 → 티스토리 HTML 변환은 새 모듈이 담당한다. 이미지 블록은 `Viruagent`의 `uploadImage()`로 실제 업로드 후, 응답 URL에서 `/dna/(.+)`를 추출해 티스토리 고유 치환자 `[##_Image|kage@...|CDM|1.3|{...}_##]`로 바꾼다. 텍스트는 `<p>`, 구분선은 `<hr>`, 인용구는 `<blockquote>`로 변환한다.
- **항상 임시저장:** 네이버와 동일한 안전 정책. `Viruagent`의 `saveDraft()`만 호출하고 공개 발행은 사용자가 티스토리 에디터에서 직접 한다. (`saveDraft`는 태그/카테고리를 저장하지 못하는 API 한계가 있어, 최종 확인·보완 단계가 어차피 필요하다.)
- **동기 응답:** HTTP 호출 기반이라 CAPTCHA/브라우저 대기가 있는 네이버보다 훨씬 빠르다. 네이버처럼 비동기 job+폴링을 두지 않고 요청/응답으로 간단히 처리한다.

## 컴포넌트

- **`src/publisher/tistoryBlocks.js`(신규)**
  - `renderBlocksToHtml(blocks, { uploadImage }): Promise<{ html: string, thumbnailKage: string|null, warnings: string[] }>`
  - `buildBlocks`가 만든 순서형 블록(`text`/`image`/`divider`/`quote`)을 순회하며 HTML 문자열로 조립.
    - `text` → `<p>...</p>` (개행은 `<br>`로 보존)
    - `divider` → `<hr>`
    - `quote` → `<blockquote><p>...</p></blockquote>`
    - `image` → 로컬 파일을 읽어 `uploadImage(buffer, filename)` 호출 → 성공 시 URL에서 `/dna/(.+)` 추출해 `kage@...`로 치환, 실패 시 해당 이미지만 건너뛰고 `warnings`에 사유 추가(전체 실패로 보지 않음)
    - 첫 번째로 성공한 이미지의 kagePath를 `thumbnailKage`로 반환(현재 `saveDraft`는 안 쓰지만, 결과에 남겨 향후 확장 대비)
  - `uploadImage`는 인자로 주입(DI) — 실제 호출은 `deps.lib.uploadImage`, 테스트는 목 함수.
- **`src/publisher/tistory.js`(신규, `naverBlog.js`와 대칭 구조)**
  - `postToTistory({ title, body, imagePaths, tags }, deps?): Promise<{ success: boolean, message: string, postUrl: string|null }>`
  - `deps.viruagentDir`(기본 `config.tistoryViruagentDir`), `deps.lib`(기본: `createRequire(import.meta.url)`로 `<viruagentDir>/src/lib/tistory.js`를 실제 require; 테스트는 `{ initBlog, saveDraft, uploadImage }` 형태의 목 주입)
  - 흐름: `viruagentDir` 미설정 검사 → `lib.initBlog()` → `buildBlocks(body, imagePaths)`(naverBlocks.js 재사용) → `renderBlocksToHtml(blocks, { uploadImage: lib.uploadImage })` → `lib.saveDraft({ title, content: html })` → 결과 매핑.
  - 예외(세션 만료, 네트워크 오류 등)는 모두 `{ success:false, message: e.message, postUrl:null }`로 감싼다.
- **`src/config.js`** — `tistoryViruagentDir: process.env.TISTORY_VIRUAGENT_DIR || ''` 추가.
- **`.env.example`** — `TISTORY_VIRUAGENT_DIR` 변수와 최초 1회 `login.js` 실행 안내 주석 추가.
- **`src/web/server.js`** — 라우트 1개 추가: `POST /api/drafts/:id/publish-tistory`
  - `d.content.blogBody` 없으면 400.
  - `db.listCards(d.id)`로 카드 이미지 경로 수집 → `postToTistory({ title: blogTitle, body: blogBody, imagePaths, tags: blogTags }, deps)` 동기 호출 → 결과 그대로 JSON 응답(잡스토어 없음).
  - DI 키: `deps.postToTistory`.
- **대시보드 UI(`index.html`/`app.js`/`style.css`)** — 기존 "네이버 블로그" 섹션 옆에 "티스토리" 섹션 추가.
  - 버튼 하나만: `#btn-publish-tistory`("🟠 티스토리 임시저장"). 생성 버튼은 네이버와 공유하므로 별도로 안 둔다.
  - 결과 표시 영역 `#tistory-result`.
  - 클릭 시: 편집된 `blogTitle`/`blogBody`/`blogTags` 먼저 저장(`PUT /api/drafts/:id/content`) → `POST /api/drafts/:id/publish-tistory` 호출 → 성공/실패 메시지 표시.

## 데이터 흐름

카드뉴스 초안 → (기존) "📝 블로그 본문 생성" 1회 → `content.blogTitle/blogBody/blogTags` 저장 → 사용자가 "📗 네이버 임시저장"과 "🟠 티스토리 임시저장" 중 하나 또는 둘 다 클릭 → 각 publisher 모듈이 같은 `blogBody` + 카드 이미지 경로를 각 플랫폼 형식으로 변환해 임시저장.

## 에러 처리

- `TISTORY_VIRUAGENT_DIR` 미설정 → 환경변수 안내 메시지로 `success:false`.
- 세션 만료/미로그인(`initBlog`가 던지는 "세션이 만료되었습니다..." 에러) → 그 메시지를 그대로 노출해 `login.js` 재실행을 유도.
- 이미지 업로드 개별 실패 → 해당 이미지만 건너뛰고 나머지는 계속 진행, 결과 메시지에 경고 포함(전체 실패로 처리하지 않음).
- `saveDraft` 자체 실패(HTTP 에러) → `success:false`, 원문 에러 메시지 반환.

## 테스트

- `tests/tistoryBlocks.test.js` — `renderBlocksToHtml`: text/divider/quote/image 각 변환, 이미지 업로드 목으로 kage@ 치환 확인, 업로드 실패 시 해당 이미지 스킵 + warnings 확인.
- `tests/tistory.test.js` — `postToTistory`: 목 `lib`로 initBlog→buildBlocks→render→saveDraft 순서/인자 검증, `viruagentDir` 미설정 케이스, 세션 만료 메시지 통과 케이스.
- `tests/server.test.js` — `POST /api/drafts/:id/publish-tistory` 라우트 추가 테스트(목 `postToTistory` 주입).

## 범위 밖

- 티스토리 공개 발행 자동화(항상 임시저장까지만).
- 티스토리 전용 콘텐츠 생성 프롬프트(기존 네이버용 생성 결과 재사용).
- 카테고리 지정(현재 재사용하는 `Viruagent`의 `saveDraft`가 카테고리 파라미터를 지원하지 않음 — 필요하면 사용자가 티스토리 에디터에서 직접 지정).
- 쇼츠(Phase 3, 별도 설계).

## Self-Review

- **Spec 커버리지:** 아키텍처(재사용 대상/방식, 로그인, 콘텐츠 재사용, 블록 변환 재사용, 임시저장 정책, 동기 응답) 전부 확정. 컴포넌트별 인터페이스(`renderBlocksToHtml`, `postToTistory`, 라우트, UI)와 DI 지점 명시. 데이터 흐름·에러 처리·테스트·범위 밖 모두 기술. ✅
- **Placeholder 스캔:** TBD/TODO 없음. ✅
- **내부 일관성:** `buildBlocks`(재사용) → `renderBlocksToHtml`(신규) → `postToTistory`(신규) → 라우트 순서가 네이버의 `buildBlocks`→`naverBlog.postToNaverBlog`→라우트 구조와 대칭. 반환 타입 `{success,message,postUrl}`이 네이버와 동일해 UI 처리 로직을 재사용하기 쉽다. ✅
- **모호성 점검:** "이미지 업로드 개별 실패 시 전체 실패로 안 봄"과 "본문 자체(saveDraft) 실패 시 전체 실패로 봄"을 구분해 명시. 카테고리 미지원은 범위 밖에 명시. ✅
