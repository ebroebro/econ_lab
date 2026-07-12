# 경제 콘텐츠 자동 발행 파이프라인

부동산·주식 등 경제 정보를 자동 수집하고, 주제를 선택하면 Gemini가 글·카드뉴스 이미지를 생성, 검수 후 클릭 한 번으로 Instagram + Threads에 배포하는 로컬 앱. (벤치마크: @apt_lap)

## 실행

```bash
npm install
npx playwright install chromium   # 최초 1회 (카드 이미지 렌더링용)
npm start
```

브라우저에서 `http://localhost:3000` 접속. (포트 변경: `.env`의 `PORT`)

서버가 켜져 있는 동안 **백그라운드 수집 에이전트**가 자동으로 동작합니다:
- 뉴스 RSS(한경·매경·연합 경제/부동산): 30분마다
- 증시 스냅샷(코스피·코스닥): 평일 장중 매시
- 한국은행 기준금리(ECOS): 매일 08:00 (키 설정 시)
- 서버 기동 직후 1회 즉시 수집

## 사용 흐름

1. **소스함** — 자동 수집된 소스 확인, 또는 주제 직접 입력. 소스 카드 클릭으로 선택(복수 가능)
2. **콘텐츠 만들기** — Gemini가 카드 문구 + 인스타 캐프션 + Threads 글 생성
3. **글 검수** — 초안 탭에서 직접 수정 / 재생성 → [글 확정]
4. **이미지 생성** — Gemini 배경 + HTML 템플릿 합성 → 1080×1350 카드 PNG (한글 안 깨짐)
5. **최종 검토** — 카드 미리보기 확인, 필요 시 이미지 다시 생성
6. **배포** — [Instagram + Threads 배포] 클릭 → 발행 이력에 링크 기록

## .env 설정

`.env.example`을 복사해 `.env` 생성 후 키 입력:

| 키 | 용도 | 발급처 |
|---|---|---|
| `GEMINI_API_KEY` | 글·배경 이미지 생성 (필수) | [Google AI Studio](https://aistudio.google.com/apikey) |
| `ECOS_API_KEY` | 한국은행 기준금리 수집 (선택) | [ECOS Open API](https://ecos.bok.or.kr/api/) |
| `CLOUDINARY_*` | 카드 이미지 공개 URL 호스팅 (배포 시 필수) | [Cloudinary 무료 가입](https://cloudinary.com) → Dashboard에서 Cloud name / API Key / Secret |
| `IG_USER_ID`, `IG_ACCESS_TOKEN` | Instagram 발행 | 아래 Meta 설정 참고 |
| `THREADS_USER_ID`, `THREADS_ACCESS_TOKEN` | Threads 발행 | 아래 Meta 설정 참고 |

키가 없어도 수집·검수·이미지 생성(그라데이션 배경 폴백)까지는 동작합니다. Gemini 키 없이는 글 생성이 안 됩니다.

## Meta(Instagram/Threads) 연동 절차

1. 인스타그램 계정을 **프로페셔널(비즈니스/크리에이터)** 로 전환하고 Facebook 페이지에 연결
2. [Meta for Developers](https://developers.facebook.com)에서 앱 생성 → **Instagram Graph API** 추가
3. 권한: `instagram_basic`, `instagram_content_publish` → Graph API 탐색기에서 장기 토큰 발급
4. `GET /me/accounts` → 페이지 ID → `GET /{page-id}?fields=instagram_business_account` 으로 **IG_USER_ID** 확인
5. Threads: 같은 앱에 **Threads API** 추가, 권한 `threads_basic`, `threads_content_publish` → 토큰 발급
6. `.env`에 입력 후 서버 재시작

## 테스트

```bash
npm test   # 외부 API 없이 전부 오프라인으로 실행됨
```

## 구조

```
src/
  collectors/   # 뉴스 RSS · 증시 · ECOS 수집기 + cron 에이전트
  generator/    # Gemini 클라이언트 + 카드뉴스 글 생성
  renderer/     # 카드 HTML 템플릿 + Playwright PNG 렌더 + Gemini 배경
  publisher/    # Cloudinary 호스팅 + Instagram/Threads 발행
  web/          # Express API + 대시보드
data/           # SQLite DB + 생성 이미지 (git 제외)
```
