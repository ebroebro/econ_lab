# 카드 템플릿 시스템 확장 — 설계 문서

날짜: 2026-07-13
상태: 승인됨 (사용자 확인)

## 배경

현재 카드뉴스는 `cover`/`text`/`data`/`outro` 4종 모두 "그라데이션 배경 + 텍스트"뿐이라, @apt_lap처럼 실제 데이터 시각화(차트·순위표)나 아이콘이 없다. 사용자는 카드 형태(차트/표/텍스트 등)를 기사·소스 상황에 따라 매번 직접 고르고 싶어하며, 그 안의 데이터는 Gemini가 초안을 채우고 사람이 검수·수정하는 방식을 원한다.

지도(지역 비교)는 서울 25개 구 경계 GeoJSON 등 별도 데이터 확보가 필요해 이번 범위에서 제외하고 후속 작업으로 미룬다.

## 확정 사항

| 항목 | 결정 |
|---|---|
| 카드 타입 | `cover`, `text`, `data`, `chart`, `table`, `outro` 6종 |
| 카드 형태 선택 주체 | 사람 (대시보드에서 소스 선택 후 카드 슬롯별로 타입 지정) |
| 데이터 채우기 | Gemini 초안 생성 + 대시보드에서 사람이 검수·수정 가능 |
| 차트 배경 | 흰색/밝은 배경 (기존 다크 그라데이션과 별도) |
| 표 배경 | 흰색/밝은 배경 |
| cover/text/data/outro 배경 | 기존 방식 유지 (다크 그라데이션 + Gemini 배경 이미지, cover·data만) |
| 지도 | 이번 범위 제외, 후속 작업 |

## 카드 타입별 데이터 구조

```
cover: { template: 'cover', title, body }
text:  { template: 'text', title, body, icon? }
data:  { template: 'data', title, body, dataLabel, icon? }
chart: { template: 'chart', title, chartType: 'line'|'bar', labels: string[], values: number[], unit? }
table: { template: 'table', title, rows: [{ rank?, label, value, delta? }] }
outro: { template: 'outro', title, body }
```

`icon`은 고정 세트(`building`, `percent`, `trend-up`, `trend-down`, `coin`, `calendar`, `alert`, `chart`) 중 하나의 키 문자열. 세트에 없는 값이 오면 아이콘 없이 렌더링(무시).

## 대시보드 워크플로 변경

기존: 소스 선택 → [콘텐츠 만들기] → Gemini가 전부 자동 생성

**변경 후**:

1. 소스함에서 소스 선택 (기존과 동일)
2. **카드 구성 화면(신규)**: 카드 슬롯 리스트. 기본값 `cover` 1 + `text` 2 + `outro` 1로 시작하며, 슬롯 추가/삭제/타입 변경(드롭다운)/순서 변경(위·아래 버튼) 가능
3. **"초안 생성"** 클릭 → Gemini에 "이 슬롯은 이런 타입이니 이런 데이터 구조로 채워라"는 지시를 포함한 프롬프트 전달, 슬롯 타입·순서를 그대로 유지한 채 데이터만 채워서 반환
4. **초안 탭 검수**: 카드 타입별로 다른 편집 UI
   - `cover`/`text`/`data`/`outro`: 기존과 동일한 제목·본문 textarea (+ `data`는 dataLabel 입력, `text`/`data`는 아이콘 드롭다운)
   - `chart`: 차트 종류(선/막대) 선택 + 라벨·값 행을 추가/삭제 가능한 표 형태 입력 + 단위 입력
   - `table`: 순위 행(순위·이름·값·증감)을 추가/삭제 가능한 표 형태 입력
5. 이미지 생성·최종 검토·배포는 기존 흐름 그대로 (카드 타입에 따라 렌더러가 알아서 다르게 그림)

## 렌더링 구현

- **Chart.js 도입**: `npm install chart.js`. 빌드된 UMD 번들(`node_modules/chart.js/dist/chart.umd.js`)을 읽어 카드 HTML에 `<script>`로 인라인 삽입(CDN 의존 없음, Playwright가 오프라인 환경에서도 렌더 가능). `animation: false`로 설정하고, 차트 인스턴스 생성 콜백에서 `window.__ready = true`를 세팅한 뒤 Playwright가 `page.waitForFunction(() => window.__ready)`로 확인 후 스크린샷
- **순위표**: 라이브러리 없이 HTML 테이블 + CSS 직접 스타일링. 순위는 원형 뱃지, 증감은 ▲(빨강)/▼(파랑) 화살표 + 색상
- **아이콘**: 8개 선 아이콘을 SVG path로 미리 정의한 아이콘 라이브러리 모듈. 카드 JSON의 `icon` 필드로 조회해 제목 옆에 삽입
- **배경**:
  - `chart`/`table`: 흰색 배경, 짙은 텍스트/축 색상으로 가독성 우선. Gemini 배경 이미지 생성 대상에서 제외(현재 `background.js`가 `cover`/`data`에만 배경을 생성하는 로직 유지, `chart`/`table`은 애초에 후보에서 제외되어 있어 추가 변경 불필요)
  - `cover`/`text`/`data`/`outro`: 기존 다크 그라데이션 + (`cover`/`data`만) Gemini 배경 이미지 유지

## Gemini 프롬프트 변경

`buildPrompt`가 소스 목록뿐 아니라 **카드 슬롯 타입 배열**을 함께 받아, 슬롯 개수·순서·타입을 그대로 유지하며 각 타입에 맞는 필드만 채우도록 지시문을 구성한다. `parseContent`는 타입별로 최소 필드 검증을 추가한다(`chart`는 `labels.length === values.length`, `table`은 `rows` 배열 존재 등).

## 오류 처리

- Chart.js 렌더링 실패(예: 데이터 불일치)는 해당 카드만 "데이터 오류" 표시 카드로 대체하고 나머지 카드는 정상 진행
- `chart`/`table` 타입인데 Gemini가 필드를 못 채우면(예: 소스에 수치 데이터 없음) 검수 화면에서 빈 값으로 표시, 사용자가 직접 입력하거나 타입을 바꿔 재생성

## 범위 제외 (YAGNI)

- 지도/지역 비교 카드 (후속 작업)
- 파이차트, 도넛차트 등 추가 차트 종류 (선/막대만 우선 지원)
- 카드 슬롯 드래그 앤 드롭 재정렬 (위/아래 버튼으로 충분)
