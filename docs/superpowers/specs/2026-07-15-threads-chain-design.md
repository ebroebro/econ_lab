# Threads 답글 체인(실제 '쓰레드') 확장 설계

**목표:** Threads에 짧은 글 1개만 올라가던 것을, 여러 개(2~4개)의 연속된 답글로 이어지는 실제 "쓰레드"로 확장한다. 톤도 인플루언서가 팔로워에게 말 걸듯 하는 후킹 있는 반말로 바꾼다(캡션은 별도, 기존 친근한 존댓말 톤 유지).

## 배경

기존 `content.threadsText`(문자열 1개) → `publishToThreads({ text, imageUrl })`가 Threads 컨테이너 생성 후 바로 발행하는 2단계 흐름이었다. Meta Threads API는 글 생성 시 `reply_to_id` 파라미터로 특정 글에 답글을 다는 것을 지원하므로, 같은 계정이 루트 글 하나를 올린 뒤 그 글에 연속으로 답글을 달면 사용자에게는 하나로 이어지는 "쓰레드"로 보인다.

## 아키텍처

- **콘텐츠 생성**(`src/generator/content.js`): 출력 필드를 `threadsText`(문자열) → `threadsPosts`(문자열 배열, 2~4개)로 바꾼다. `buildPrompt`/`buildStoryPrompt` 두 곳 모두 수정한다(현재 캡션/threadsText 지시문이 두 함수에 중복돼 있는 기존 구조를 그대로 따름 — 새 추상화를 만들지 않는다).
- **발행**(`src/publisher/threads.js`): `publishToThreads({ text, imageUrl }, fetchFn, creds)`의 시그니처는 그대로 두되, `text`가 배열이면 체인 발행 로직을, 문자열이면 기존 단일 발행 로직을 탄다. 즉 함수 하나가 두 입력 형태를 다 받는다 — 기존 테스트(문자열 입력)는 코드 변경 없이 그대로 통과해야 한다.
- **서버 라우트**(`src/web/server.js`): `POST /api/drafts/:id/publish`에서 `publishThreads`에 넘기는 `text`를 `d.content.threadsPosts?.length ? d.content.threadsPosts : d.content.threadsText`로 바꿔, 새 초안은 배열을, 과거 초안(threadsPosts 없음)은 기존 문자열을 그대로 넘긴다 — DB 마이그레이션 없이 하위 호환.
- **UI**(`src/web/public/*`): 기존 Threads 글 textarea 1개를 "1번째 글~4번째 글" 고정 4칸으로 바꾼다. 렌더링 시 `content.threadsPosts`가 있으면 그 배열을, 없고 `content.threadsText`만 있으면(과거 초안) 1번째 칸에만 채워서 보여준다. 저장 시 빈 칸은 걸러내고 배열로 모아 `threadsPosts`에 담는다.

## 콘텐츠 생성 상세

**`threadsPosts` 프롬프트 지시문(캡션 지시문 옆에 나란히):**

> "threadsPosts: 인플루언서가 팔로워에게 말 걸듯 반말로 캐주얼하고 임팩트 있게 쓴 연속된 글 2~4개(소스가 얇으면 2개, 풍부하면 4개까지 — 억지로 늘리지 않는다). 1번째 글은 후킹(질문·놀라운 숫자·공감 포인트)으로 시작한다. 각 글은 200자 이내. 투자 조언은 하지 않는다. 마지막 글에만 '자세한 카드뉴스는 인스타그램에서 확인' 유도 문구를 넣는다(계정명 없이)."

**출력 JSON 형식**: `{"caption":"...","cards":[...],"threadsPosts":["...","...","..."]}` — 기존 `threadsText` 키를 대체한다(둘 다 넣지 않음).

**`parseContent`/`parseStoryContent` 보정 로직 변경:**
- 필수 필드 체크를 `!obj.threadsText` → `!Array.isArray(obj.threadsPosts) || obj.threadsPosts.length === 0`로 바꾼다.
- `threadsPosts`는 `String(...)`으로 캐스팅, 빈 문자열 걸러내고, 최대 4개로 자른다.

**캡션(`caption`) 지시문도 함께 톤 조정**: "100만 팔로워를 가진 인플루언서가 팔로워에게 직접 꿀팁을 알려주듯, 첫 문장부터 눈길을 끄는 후킹으로 시작해 친근하고 임팩트 있게 쓴다(이모지 적절히 포함). 투자 조언·과장된 단정 표현은 쓰지 않는다. 300자 이내 + 해시태그 8~12개." (존댓말 기반, 반말 강제 아님 — threadsPosts와 톤 차이를 둔다.)

## 발행 상세 (`threads.js`)

```
publishToThreads({ text, imageUrl }, fetchFn, creds):
  if Array.isArray(text):
    posts = text.filter(non-empty)
    root = 기존 단일 발행 로직(posts[0], imageUrl)  // 컨테이너 생성 → 발행 → permalink 조회
    lastId = root.id
    for post in posts[1..]:
      컨테이너 생성(media_type=TEXT, text=post, reply_to_id=lastId) → 발행
      lastId = 그 글의 id
    return { id: root.id, permalink: root.permalink }  // 반환 형태는 기존과 동일
  else:
    기존 로직 그대로 (문자열 단일 발행)
```

- 답글 발행 중 하나가 실패하면(예: 3번째 글 실패) 그 지점에서 중단하고, 이미 발행된 루트 글의 `permalink`는 그대로 반환하되 에러를 함께 던진다(부분 발행이라도 사용자가 무슨 일이 있었는지 알 수 있어야 함 — 구체적 처리는 구현 단계에서 정한다).
- 답글에는 이미지가 붙지 않는다(루트 글에만 카드 이미지 1장 첨부, 기존과 동일).

## 서버 라우트 변경

`app.post('/api/drafts/:id/publish', ...)`에서:
```js
result.threads = await publishThreads({
  text: d.content.threadsPosts?.length ? d.content.threadsPosts : d.content.threadsText,
  imageUrl: urls[0],
});
```
그 외 배포 흐름(Instagram, 이미 발행된 플랫폼 스킵 로직 등)은 변경하지 않는다.

## UI 변경

- `index.html`의 `<h2>Threads 글</h2><textarea id="ed-threads">` 한 칸을 `#ed-thread-1` ~ `#ed-thread-4` 4칸으로 바꾼다. placeholder로 "1번째 글(후킹)", "2번째 글", "3번째 글", "4번째 글(마지막에만 유도 문구)" 정도로 안내한다.
- `renderDraftDetail()`: `content.threadsPosts`(배열)가 있으면 각 칸에 순서대로 채우고, 없고 `content.threadsText`만 있으면 1번째 칸에만 채운다(나머지는 빈 칸).
- `collectEditedContent()`: 4칸 값 중 빈 문자열이 아닌 것만 모아 `threadsPosts` 배열로 저장한다(레거시 `threadsText` 키는 더 이상 쓰지 않지만, 기존 값이 `content`에 남아있어도 무해하므로 굳이 지우지 않는다).

## 에러 처리

- `threadsPosts`가 전부 빈 문자열이면(사용자가 다 지운 경우) 발행 시 네이버/티스토리와 동일한 패턴으로 "Threads 글을 입력하세요" 류의 400을 반환한다 — 다만 이건 기존 `/api/drafts/:id/publish`가 Instagram과 함께 묶여 있는 라우트라, Threads만 비어도 전체 발행을 막을지 Threads만 건너뛸지는 구현 단계에서 기존 라우트의 기존 에러 처리 관례(개별 플랫폼 실패는 `{error: e.message}`로 담고 계속 진행)를 따른다.
- 체인 중간 실패는 위 "발행 상세"에 정리한 대로 부분 성공을 반환값에 반영한다.

## 테스트

- `tests/content.test.js`: `threadsPosts` 배열 검증(필수 필드 체크, 빈 문자열 제거, 4개 초과 시 자르기), 프롬프트에 "반말"/"200자"/"마지막 글"같은 핵심 지시 문구가 들어가는지 확인. 기존 `threadsText` 관련 assertion은 `threadsPosts`로 갱신.
- `tests/threads.test.js`: 기존 문자열 입력 테스트 2개는 그대로 유지(회귀 확인). 배열 입력 테스트 추가 — 루트 글은 이미지+첫 텍스트로, 이후 글들은 `reply_to_id`가 이전 글 id로 연결되는지, 답글에는 이미지 파라미터가 없는지 확인.
- `tests/server.test.js`: publish 라우트가 `threadsPosts` 있으면 배열을, 없으면 `threadsText`를 넘기는지 확인.

## 범위 밖

- 동적 추가/삭제 UI(카드 슬롯 빌더 같은) — 고정 4칸으로 충분.
- 인스타그램 캡션의 반말화 — 캡션은 기존 톤 유지, threadsPosts만 반말.
- 기존 DB에 저장된 `threadsText`를 `threadsPosts`로 일괄 변환하는 마이그레이션 스크립트.

## Self-Review

- **Spec 커버리지:** 콘텐츠 생성(프롬프트+파싱), 발행(체인 로직), 서버 라우트, UI, 에러 처리, 테스트, 범위 밖 모두 기술. ✅
- **Placeholder 스캔:** 없음. ✅
- **내부 일관성:** `publishToThreads`가 문자열/배열 두 입력을 다 받는다는 계약이 발행 상세·서버 라우트·테스트 세 군데에서 일관되게 서술됨. UI의 "1번째 칸에만 채움" 하위 호환 로직이 서버 라우트의 "threadsPosts 없으면 threadsText" 하위 호환과 같은 방향(과거 데이터 안 버림). ✅
