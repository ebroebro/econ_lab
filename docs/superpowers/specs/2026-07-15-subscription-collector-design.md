# 청약 정보 수집 + 전용 카드 타입 설계

**목표:** 공공데이터포털 "한국부동산원_청약홈_APT 분양정보" API로 아파트 청약 공고를 자동 수집해 소스함에 쌓고, 그걸 카드뉴스로 만들 때 단지명·지역·총세대수·접수기간·당첨자발표일이 나오는 전용 카드 타입(`subscription`)으로 렌더링한다.

## 배경

- 기존 뉴스/증시/부동산 수집기는 백그라운드 cron으로 자동 수집만 하고, 초안(카드뉴스) 생성은 사용자가 대시보드에서 소스를 골라 직접 트리거한다. 청약 정보도 이 패턴을 그대로 따른다(사용자 확인 완료) — 새 공고 발견 시 초안까지 자동 생성하는 건 범위 밖.
- 카드 데이터 구조(접수기간·발표일 등)가 일반 뉴스와 달라서, 기존 범용 카드 타입(`data`/`table`)에 억지로 끼워 맞추지 않고 전용 카드 타입을 새로 만들기로 함(사용자 확인 완료).
- API는 `real-estate-mcp`(https://github.com/tae0y/real-estate-mcp) 저장소 소스를 참고해 실제 호출 방식을 확인했다 — 이 저장소(Python/MCP)를 그대로 재사용하지 않고, 이 프로젝트의 기존 수집기(`news.js`/`stocks.js`/`realestate.js`)와 같은 방식으로 그 REST API를 직접 호출하는 새 수집기를 만든다.
- API 서비스: **한국부동산원_청약홈_APT 분양정보**(https://www.data.go.kr/data/15101046/fileData.do). 인증키는 `.env`의 `DATA_GO_KR_API_KEY`(디코딩 키)로 이미 설정 완료.

## API 상세

- 엔드포인트: `GET https://api.odcloud.kr/api/15101046/v1/uddi:14a46595-03dd-47d3-a418-d64e52820598`
- 쿼리 파라미터: `page`, `perPage`, `returnType=JSON`, `serviceKey=<encodeURIComponent(DATA_GO_KR_API_KEY)>`
- 응답 형태: `{ totalCount, data: [...], page, perPage, currentCount, matchCount }` — `data`가 공고 배열.
- **실제 키로 호출해 필드명을 확인 완료**(2026-07-15). 이 수집기가 쓸 필드:
  - `주택관리번호`(숫자, 공고 고유 식별자)
  - `주택명`(단지명)
  - `공급지역명`(예: "경기", "제주")
  - `공급규모`(숫자, 세대수)
  - `청약접수시작일`/`청약접수종료일`(YYYY-MM-DD)
  - `당첨자발표일`(YYYY-MM-DD)
  - `모집공고일`(YYYY-MM-DD)
  - `모집공고홈페이지주소`(공고 상세 페이지 실제 URL — 청약홈 사이트, 공고마다 고유)
  - 값이 없는 필드는 `null`로 온다(예: 특별공급접수시작일이 없는 공고). 수집기는 누락된 값을 안전한 기본값(빈 문자열/0)으로 처리한다.
- `perPage`는 100으로 호출한다(전체 2,594건 중 최신 페이지 우선순위는 API가 정하는 기본 정렬을 따름 — 날짜 파라미터로 필터링하는 옵션은 이 API에 없음). 매일 1회 100건을 가져와 겹치는 공고는 아래 중복 방지로 자동 스킵된다.

## 아키텍처

- **수집기**(`src/collectors/subscription.js`): 위 API를 호출해 각 공고를 `type: 'subscription'` 소스로 저장. 기존 `realestate.js`와 동일한 패턴(단일 함수, DI로 `fetchFn` 주입 가능, 키 없으면 스킵)을 따른다.
  - `title`: `주택명`
  - `url`: `모집공고홈페이지주소`(공고마다 고유한 실제 링크 — 사용자가 클릭해 원본 공고를 볼 수도 있음)
  - `summary`: `${공급지역명} · 총 ${공급규모}세대 · 접수 ${청약접수시작일}~${청약접수종료일}` 형태로 조합
  - `data`: `{ region, totalSupply, receiptStart, receiptEnd, winnerDate, noticeDate }`(위 필드들을 그대로 담음)
- **중복 방지**: 새 스키마/컬럼 없이, 기존 `db.insertSource`의 `url` 유니크 인덱스를 그대로 활용한다. `모집공고홈페이지주소`가 공고마다 고유한 실제 URL이라 이걸 그대로 `url`에 넣으면, 같은 공고가 다음 수집 때 다시 나와도 같은 url이라 자동으로 중복 삽입되지 않는다(`realestate.js`가 합성 URL `ecos://base-rate/<월>`로 하는 것과 같은 메커니즘이지만, 여기서는 API가 이미 주는 실제 URL을 그대로 쓴다).
- **cron 등록**(`src/collectors/agent.js`, `src/index.js`): `runAllCollectors`에 추가하고, 부동산과 같은 매일 1회 주기(예: 매일 08:30)로 스케줄.
- **콘텐츠 생성**(`src/generator/content.js`): `VALID_TEMPLATES`에 `'subscription'` 추가, 전용 필드 스펙과 파싱 정규화 추가. 프롬프트의 "디자인 원칙"에 "청약/분양 공고 소스면 subscription 템플릿을 쓴다" 안내를 추가해, 카드 개수를 자동으로 정하는 모드에서도 Gemini가 이 템플릿을 선택하게 한다.
- **HTML 폴백 렌더링**(`src/renderer/templates.js`): 새 CSS 없이 기존 `data` 템플릿의 `big-stat`/`mini-rows` 스타일을 재사용.
- **AI 이미지 프롬프트**(`src/renderer/aiCard.js`): `data` 템플릿 브랜치와 유사한 구조(헤드라인+큰 숫자+리스트)로 새 브랜치 추가.
- **대시보드 카드 편집기**(`src/web/public/app.js`): `subscription` 전용 편집 UI(제목·지역·총세대수·접수시작·접수종료·발표일 6개 입력칸) 추가.
- **라벨/배지**: `TYPE_LABEL.subscription = '청약'`(소스함 배지), `TEMPLATE_LABEL.subscription = '청약정보'`(카드 타입 드롭다운), `style.css`에 배지 색상 1개 추가.

## 카드 타입 스펙

```json
{"template":"subscription","title":"(단지명, 20자 이내)","region":"(공급지역, 예: 서울 강남구)","totalSupply":"(총공급세대수, 예: 128세대)","receiptStart":"(청약접수 시작일)","receiptEnd":"(청약접수 종료일)","winnerDate":"(당첨자 발표일)","tag":{"text":"청약정보","color":"blue"},"source":""}
```

`parseContent`의 카드별 정규화 로직에 `subscription` 분기를 추가해 모든 필드를 문자열로 기본값 처리한다(`title`/`tag`/`source`는 기존 공통 로직이 이미 처리).

## 데이터 흐름

cron → `collectSubscriptions` → 소스함(`type: subscription`, 기존 주제별 그룹핑 UI가 제목의 "청약"/"분양" 키워드로 자동으로 "청약" 섹션에 묶음 — 이 기능은 이미 구현되어 있어 추가 작업 불필요) → 사용자가 소스 선택 → 카드 구성(자동 또는 수동으로 "청약정보" 선택) → Gemini가 `subscription` 필드 채움 → 카드 편집에서 확인·수정 → 이미지 생성(AI 우선, 실패 시 HTML 폴백) → 기존 Instagram/Threads/블로그 배포 그대로.

## 에러 처리

- `DATA_GO_KR_API_KEY` 없으면 수집 건너뜀(0건 반환), 기존 `realestate.js` 관례와 동일.
- API 호출 실패(HTTP 에러, 네트워크 오류, JSON 파싱 실패)는 콘솔에 로그만 남기고 0건 반환 — 전체 cron 파이프라인을 막지 않는다.
- 응답의 `data` 배열이 비어있거나 필드가 없으면 해당 항목은 안전한 기본값(빈 문자열)으로 채워 저장한다.

## 테스트

- `tests/subscription.test.js`(신규): 키 없으면 스킵, 정상 응답을 소스로 저장(필드 매핑 확인), 같은 공고(같은 `모집공고홈페이지주소`) 재수집 시 중복 삽입 안 됨 — `realestate.test.js`와 동일한 테스트 패턴.
- `tests/content.test.js`: `subscription` 템플릿 스펙 문구가 프롬프트에 들어가는지, `parseContent`가 필드 기본값을 채우는지.
- `tests/templates.test.js`: `subscription` 카드의 HTML 렌더링(제목·지역·총세대수·접수기간·발표일).
- `tests/aiCard.test.js`: `subscription` 카드의 AI 이미지 프롬프트 문구.

## 범위 밖

- 청약 경쟁률/당첨자 통계 API(`get_apt_subscription_results` 상당) — 공고 정보만 다룬다.
- 새 공고 수집 시 초안 자동 생성(사용자 확인 완료 — 수집만 자동, 초안은 수동).

## Self-Review

- **Spec 커버리지:** API 상세(실제 호출로 필드명 검증 완료), 수집기·중복방지·cron, 콘텐츠 생성·렌더링·편집 UI·라벨까지 전 구간, 데이터 흐름, 에러 처리, 테스트, 범위 밖 모두 기술. ✅
- **Placeholder 스캔:** 없음. ✅
- **내부 일관성:** 중복 방지 방식(실제 `모집공고홈페이지주소`를 url로 활용)이 배경·아키텍처·테스트 세 군데서 일관되게 설명됨. "자동 수집만, 초안은 수동"이 배경과 범위 밖 두 군데서 일치. ✅
