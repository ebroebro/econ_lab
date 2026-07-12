# 경제 콘텐츠 자동 발행 파이프라인 — 설계 문서

날짜: 2026-07-12
상태: 승인됨 (사용자 확인)

## 목표

부동산·주식 등 경제 정보를 자동 수집하고, 사용자가 주제를 선택하면 Gemini로 글과 카드뉴스 이미지를 생성, 대시보드에서 검수한 뒤 버튼 클릭 한 번으로 Instagram(캐러셀)과 Threads에 자동 배포한다. 벤치마크: 인스타그램 @apt_lap (부동산 데이터 카드뉴스, 39만 팔로워).

## 확정 사항

| 항목 | 결정 |
|---|---|
| 배포 방식 | Meta 공식 API — Instagram Graph API(캐러셀) + Threads API |
| 관리 도구 | 로컬 웹 대시보드 (Express + SQLite, `localhost:3000`) |
| 수집 소스 | 경제 뉴스 RSS(한경·매경·연합 등), 부동산 공공 데이터(ECOS 기준금리, 국토부 실거래가 등), 증시 데이터(코스피·환율 등), 직접 입력 주제 |
| 글 생성 | Gemini API (텍스트·이미지 모두 Gemini로 통일) |
| 이미지 | 하이브리드 — HTML 템플릿에 한글 문구·차트를 정확히 렌더링, 배경 비주얼만 Gemini 생성, Playwright로 1080×1350 PNG 캡처 |
| Threads 형태 | 텍스트 위주 + 대표 이미지 1장 + 인스타그램 유도 CTA |
| 지속 수집 | 앱 내 백그라운드 수집 에이전트(스케줄러)가 서버 구동 중 계속 자동 수집 |

## 아키텍처

Node.js 단일 앱. `npm start` 하나로 서버·대시보드·백그라운드 수집 에이전트가 함께 뜬다.

```
[백그라운드 수집 에이전트 (node-cron)]
  ├─ 뉴스 RSS 수집기 (30분~1시간 간격)
  ├─ 공공 데이터 수집기 (일 단위: ECOS, 실거래가 등)
  └─ 증시 데이터 수집기 (장중 간격)
        ↓ SQLite: sources 테이블 (중복 제거 후 적재)
[대시보드 (localhost:3000)]
  1. 소스함: 수집된 소스 카드 목록, 직접 입력 폼
  2. 주제 선택 → "콘텐츠 만들기"
  3. 글 생성: Gemini → 캐프션 + 카드별 문구 + Threads 글
  4. 글 검수: 인라인 편집, 재생성
  5. 이미지 생성: Gemini 배경 + HTML 템플릿 합성 → Playwright PNG 캡처
  6. 최종 검토: 인스타풍 캐러셀 미리보기, 개별 카드 재생성
  7. 배포 클릭 → 이미지 호스팅 업로드(공개 URL) → Instagram 캐러셀 + Threads 게시
        ↓ SQLite: posts 테이블 (발행 URL·시각 기록)
```

## 구성 요소

### 1. 백그라운드 수집 에이전트 (`src/collectors/`)
- `node-cron` 기반. 서버 프로세스 안에서 상시 동작.
- 뉴스: RSS 파싱(rss-parser), 경제·부동산 섹션. 제목+링크+요약 저장, URL 기준 중복 제거.
- 공공 데이터: 한국은행 ECOS API(기준금리·환율), 국토부 실거래가 공공데이터포털 API. API 키는 `.env`.
- 증시: 네이버 금융 등 공개 엔드포인트에서 코스피·코스닥·환율 시세.
- 수집 결과는 `sources` 테이블에 상태 `new`로 적재. 대시보드 소스함에 노출.

### 2. 콘텐츠 생성기 (`src/generator/`)
- Gemini API (`@google/genai`).
- 입력: 선택된 소스(들) + 콘텐츠 유형(데이터 카드뉴스/뉴스 요약 등).
- 출력(JSON): 표지 문구, 본문 카드 3~7장 문구, 인스타 캐프션(+해시태그), Threads 글(인스타 유도 CTA 포함).
- 투자 조언 금지 — 정보 전달 톤. 프롬프트에 명시.

### 3. 카드 렌더러 (`src/renderer/`)
- @apt_lap풍 HTML 템플릿: 표지 / 데이터·차트 / 텍스트 본문 / 마무리(팔로우 유도) 4종.
- 차트는 Chart.js 등으로 템플릿 내 렌더링(한글 정확).
- 배경 비주얼: Gemini 이미지 모델로 생성 후 템플릿 배경에 합성. 실패 시 그라데이션 폴백.
- Playwright(headless chromium)로 1080×1350 PNG 캡처. `data/images/<draftId>/`에 저장.

### 4. 대시보드 (`src/web/`)
- Express + 서버사이드 렌더링(또는 경량 SPA). 화면: 소스함 / 초안 편집 / 카드 미리보기 / 발행 이력.
- 초안 상태 머신: `draft → text_approved → images_ready → published`.

### 5. 발행기 (`src/publisher/`)
- 이미지 호스팅: Cloudinary 무료 플랜에 업로드해 공개 URL 확보 (Instagram API 요구사항).
- Instagram Graph API: 캐러셀 컨테이너 생성 → 게시. 캐프션 포함.
- Threads API: 텍스트 + 대표 이미지 1장 게시.
- 성공 시 발행 URL·시각을 `posts`에 기록, 실패 시 오류를 대시보드에 표시(부분 실패 허용: 인스타 성공/Threads 실패 각각 기록).

## 데이터 모델 (SQLite)

- `sources`: id, type(news|realestate|stock|manual), title, url, summary, data(JSON), collected_at, status(new|used|archived)
- `drafts`: id, source_ids(JSON), content(JSON: 카드 문구·캐프션·threads 글), status, created_at, updated_at
- `cards`: id, draft_id, seq, template, image_path, bg_image_path
- `posts`: id, draft_id, instagram_url, threads_url, published_at, error(JSON)

## 오류 처리

- 수집 실패: 해당 소스만 건너뛰고 로그. 다음 주기에 재시도.
- Gemini 실패/한도: 오류 메시지를 대시보드에 표시, 재시도 버튼.
- 발행 실패: 단계별(호스팅 업로드/컨테이너 생성/게시) 오류를 구분해 표시. 재배포 버튼.
- API 키 미설정: 대시보드 설정 화면에서 안내.

## 사전 준비물 (2단계에서 함께 설정)

1. 인스타그램 프로페셔널 계정 전환 + Facebook 페이지 연결
2. Meta 개발자 앱 등록 (instagram_content_publish, threads 권한) + 장기 액세스 토큰
3. Gemini API 키
4. Cloudinary 무료 계정 (이미지 공개 URL용)
5. (선택) 공공데이터포털·ECOS API 키

## 구축 순서

- **1단계**: 수집 에이전트 + 대시보드 + 글 생성 + 카드 이미지 생성 (배포 제외) — 결과물 품질 확인
- **2단계**: Meta API 연동(계정 설정 동반) → 실제 자동 배포

## 범위 제외 (YAGNI)

- 예약 발행/자동 발행 스케줄 (검수 후 수동 클릭이 요구사항)
- 다중 계정 관리, 댓글 자동 응답, 성과 분석
- 클라우드 배포 (로컬 PC 실행 전제)
