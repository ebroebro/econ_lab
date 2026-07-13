# 카드 템플릿 시스템 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카드뉴스에 실제 데이터 차트(선/막대)·순위표·아이콘을 추가하고, 대시보드에서 카드마다 형태(타입)를 사람이 직접 고른 뒤 Gemini가 그 형태에 맞춰 내용을 채우도록 확장한다.

**Architecture:** 카드 타입을 `cover`/`text`/`data`/`chart`/`table`/`outro` 6종으로 확장. 렌더러(`templates.js`)가 타입별로 다른 HTML을 생성하고(차트는 Chart.js를 인라인 삽입, 표는 순수 HTML/CSS), `render.js`는 모든 카드가 `window.__ready === true`를 세팅한 뒤 스크린샷을 찍도록 통일한다. 대시보드는 소스 선택 후 "카드 구성" 단계를 추가해 슬롯별 타입을 고르고, Gemini 프롬프트가 그 타입 배열을 그대로 따르도록 지시한다.

**Tech Stack:** 기존 스택(Node.js/Express/Playwright/Gemini) + `chart.js`(신규 의존성, UMD 빌드를 로컬 파일로 읽어 인라인 삽입).

## Global Constraints

- 카드 이미지 규격은 기존과 동일하게 1080×1350 유지.
- `chart`/`table` 타입은 흰색 배경(`.card.light`), 나머지(`cover`/`text`/`data`/`outro`)는 기존 다크 그라데이션 유지.
- 지도(지역 비교) 타입은 이번 범위에서 제외.
- Gemini 생성 결과에 투자 조언 금지 규칙은 기존과 동일하게 유지.
- 아이콘은 `building`, `percent`, `trend-up`, `trend-down`, `coin`, `calendar`, `alert`, `chart` 8종 고정 세트만 사용.
- 모든 새 코드는 ESM(`import`/`export`), Windows 경로 안전성(`path.join`) 유지.

---

## 파일 구조

```
src/
  renderer/
    icons.js        # 신규 — SVG 아이콘 라이브러리
    templates.js     # 수정 — chart/table/icon 렌더링 추가
    render.js        # 수정 — Chart.js 인라인 삽입, __ready 대기
  generator/
    content.js        # 수정 — 카드 타입 배열 기반 프롬프트 + 타입별 검증
  web/
    server.js          # 수정 — cardTypes 파라미터 plumbing
    public/
      index.html        # 수정 — 카드 구성(슬롯 빌더) 패널 추가
      app.js             # 수정 — 슬롯 빌더 + 타입별 카드 에디터
      style.css          # 수정 — 슬롯/차트행/표행 스타일
tests/
  icons.test.js       # 신규
  templates.test.js   # 수정(확장)
  content.test.js     # 수정(확장 + 시그니처 변경 반영)
  server.test.js       # 수정(cardTypes 전달 검증 추가)
package.json           # chart.js 의존성 추가
```

---

### Task 1: 아이콘 라이브러리

**Files:**
- Create: `src/renderer/icons.js`
- Test: `tests/icons.test.js`

**Interfaces:**
- Produces: `getIconSvg(name, { size = 56, color = '#fff' } = {})` → SVG 문자열 (알 수 없는 name이면 빈 문자열). `ICON_NAMES` → 8개 이름 배열 export.

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/icons.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getIconSvg, ICON_NAMES } from '../src/renderer/icons.js';

test('알려진 아이콘은 svg 태그를 반환한다', () => {
  const svg = getIconSvg('building', { size: 72, color: '#12202b' });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('width="72"'));
  assert.ok(svg.includes('#12202b'));
});

test('알 수 없는 아이콘은 빈 문자열을 반환한다', () => {
  assert.equal(getIconSvg('not-a-real-icon'), '');
});

test('빈 문자열/undefined도 안전하게 처리한다', () => {
  assert.equal(getIconSvg(''), '');
  assert.equal(getIconSvg(undefined), '');
});

test('ICON_NAMES에 8개 아이콘이 정의되어 있다', () => {
  assert.equal(ICON_NAMES.length, 8);
  assert.ok(ICON_NAMES.includes('trend-up'));
  assert.ok(ICON_NAMES.includes('percent'));
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test` / Expected: FAIL (icons.js 없음)

- [ ] **Step 3: src/renderer/icons.js 구현**

```js
// Lucide 스타일 선 아이콘 (MIT 라이선스 아이콘 세트의 path 데이터를 그대로 사용)
const ICONS = {
  building: '<path d="M6 22V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v18"/><path d="M6 12H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2"/><path d="M18 9h2a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-2"/><path d="M10 6h.01"/><path d="M14 6h.01"/><path d="M10 10h.01"/><path d="M14 10h.01"/><path d="M10 14h.01"/><path d="M14 14h.01"/><path d="M10 18h.01"/><path d="M14 18h.01"/>',
  percent: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  'trend-up': '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  'trend-down': '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  coin: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
};

export const ICON_NAMES = Object.keys(ICONS);

export function getIconSvg(name, { size = 56, color = '#fff' } = {}) {
  const paths = ICONS[name];
  if (!paths) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `npm test` / Expected: PASS (4 tests)
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: 아이콘 라이브러리 추가"`

---

### Task 2: 카드 템플릿 렌더링 — chart/table/icon 지원

**Files:**
- Modify: `src/renderer/templates.js`
- Modify: `tests/templates.test.js`

**Interfaces:**
- Consumes: `getIconSvg(name, opts)` from Task 1 (`src/renderer/icons.js`)
- Produces: `renderCardHtml(card, { seq, total, bgDataUri = null, brand = 'ECON LAB', chartLibJs = '' } = {})` — 반환 HTML은 항상 `window.__ready = true;`를 포함하는 `<script>`로 끝난다(모든 타입 공통, `render.js`가 이걸로 렌더 완료를 대기).
  - `card.template === 'chart'`일 때 필요한 필드: `labels: string[]`, `values: number[]`, `chartType: 'line'|'bar'`, `unit?: string`
  - `card.template === 'table'`일 때 필요한 필드: `rows: [{ rank?, label, value, delta? }]`
  - `card.template === 'text'|'data'`일 때 선택 필드: `icon?: string` (Task 1의 `ICON_NAMES` 중 하나)

- [ ] **Step 1: 실패하는 테스트 추가** (`tests/templates.test.js`에 아래 테스트들을 추가, 기존 3개 테스트는 그대로 유지)

```js
test('chart 카드는 캔버스와 Chart 인스턴스 스크립트를 포함하고 밝은 배경이다', () => {
  const html = renderCardHtml(
    { template: 'chart', title: '기준금리 추이', chartType: 'line', labels: ['1월', '2월'], values: [3.0, 2.75], unit: '%' },
    { seq: 2, total: 5, chartLibJs: '/* chartjs */' }
  );
  assert.ok(html.includes('<canvas'));
  assert.ok(html.includes('new Chart('));
  assert.ok(html.includes('class="card light"'));
  assert.ok(html.includes('/* chartjs */'));
  assert.ok(html.includes('단위: %'));
});

test('chart 카드에 데이터가 없으면 캔버스 대신 안내 문구를 보여준다', () => {
  const html = renderCardHtml(
    { template: 'chart', title: '데이터 없음', labels: [], values: [] },
    { seq: 2, total: 5 }
  );
  assert.ok(!html.includes('<canvas'));
  assert.ok(html.includes('데이터가 없습니다'));
});

test('table 카드는 순위·이름·값·증감을 행으로 렌더링한다', () => {
  const html = renderCardHtml(
    { template: 'table', title: '거래량 순위', rows: [
      { rank: 1, label: '강남구', value: '1,204건', delta: '+12' },
      { rank: 2, label: '송파구', value: '980건', delta: '-3' },
    ] },
    { seq: 3, total: 5 }
  );
  assert.ok(html.includes('강남구'));
  assert.ok(html.includes('1,204건'));
  assert.ok(html.includes('rank-delta down')); // -3은 down 클래스
  assert.ok(html.includes('class="card light"'));
});

test('text 카드에 icon이 있으면 svg가 포함된다', () => {
  const html = renderCardHtml(
    { template: 'text', title: '금리 인상', body: '설명', icon: 'trend-up' },
    { seq: 2, total: 5 }
  );
  assert.ok(html.includes('<svg'));
});

test('icon이 없는 카드는 svg를 포함하지 않는다', () => {
  const html = renderCardHtml({ template: 'text', title: '제목', body: '본문' }, { seq: 2, total: 5 });
  assert.ok(!html.includes('<svg'));
});

test('모든 카드는 렌더 완료 신호를 포함한다', () => {
  const html = renderCardHtml({ template: 'cover', title: 't', body: '' }, { seq: 1, total: 1 });
  assert.ok(html.includes('window.__ready = true'));
});

test('cover/outro는 여전히 다크 배경(light 클래스 없음)이다', () => {
  const html = renderCardHtml({ template: 'cover', title: 't', body: '' }, { seq: 1, total: 1 });
  assert.ok(!html.includes('class="card light"'));
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test` / Expected: FAIL (chart/table 렌더링 없음)

- [ ] **Step 3: src/renderer/templates.js 전체 교체**

```js
import { getIconSvg } from './icons.js';

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
.card.light { background:#ffffff; color:#12202b; }
.bg { position:absolute; inset:0; background-size:cover; background-position:center; opacity:.35; }
.inner { position:relative; z-index:1; }
.brand { position:absolute; top:60px; left:90px; font-size:30px; letter-spacing:2px; opacity:.85; z-index:1; }
.card.light .brand { opacity:.55; }
.page { position:absolute; top:60px; right:90px; font-size:28px; opacity:.7; z-index:1; }
.icon { margin-bottom:36px; }
h1 { font-size:88px; font-weight:800; line-height:1.25; word-break:keep-all; }
h2 { font-size:64px; font-weight:800; line-height:1.3; word-break:keep-all; margin-bottom:40px; }
p  { font-size:44px; line-height:1.6; word-break:keep-all; opacity:.95; }
.data { font-size:120px; font-weight:900; margin:50px 0; }
.outro h2 { font-size:72px; }
.chart-wrap { width:900px; height:640px; margin-top:20px; }
.chart-unit { font-size:32px; opacity:.6; margin-top:16px; }
table.rank-table { width:100%; border-collapse:collapse; margin-top:20px; }
table.rank-table td { padding:22px 10px; font-size:38px; border-bottom:2px solid #12202b1a; }
.rank-badge {
  display:inline-flex; align-items:center; justify-content:center;
  width:56px; height:56px; border-radius:50%; background:#12202b; color:#fff;
  font-weight:800; font-size:30px;
}
.rank-label { font-weight:700; }
.rank-delta.up { color:#d6293e; }
.rank-delta.down { color:#1d6fd6; }
`;

function renderChartInner(card) {
  const hasData = Array.isArray(card.labels) && Array.isArray(card.values)
    && card.labels.length > 0 && card.labels.length === card.values.length;
  if (!hasData) {
    return `<h2>${esc(card.title)}</h2><p>⚠ 차트 데이터가 없습니다. 직접 입력해주세요.</p>`;
  }
  const chartType = card.chartType === 'bar' ? 'bar' : 'line';
  return `<h2>${esc(card.title)}</h2>
    <div class="chart-wrap"><canvas id="chart" width="900" height="640"></canvas></div>
    ${card.unit ? `<div class="chart-unit">단위: ${esc(card.unit)}</div>` : ''}
    <script>
      new Chart(document.getElementById('chart'), {
        type: ${JSON.stringify(chartType)},
        data: {
          labels: ${JSON.stringify(card.labels)},
          datasets: [{
            data: ${JSON.stringify(card.values)},
            borderColor: '#1d6fd6', backgroundColor: '#1d6fd688',
            borderWidth: 4, tension: 0.3, fill: ${chartType === 'line'}
          }]
        },
        options: {
          responsive: false, animation: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { font: { size: 26 }, color: '#12202b' } },
            y: { ticks: { font: { size: 26 }, color: '#12202b' } }
          }
        }
      });
    </script>`;
}

function renderTableInner(card) {
  const rows = (card.rows || []).map((r, i) => {
    const deltaStr = String(r.delta ?? '');
    const dir = deltaStr.trim().startsWith('-') ? 'down' : 'up';
    return `
      <tr>
        <td><span class="rank-badge">${esc(String(r.rank ?? i + 1))}</span></td>
        <td class="rank-label">${esc(r.label || '')}</td>
        <td>${esc(String(r.value ?? ''))}</td>
        <td class="rank-delta ${dir}">${esc(deltaStr)}</td>
      </tr>`;
  }).join('');
  return `<h2>${esc(card.title)}</h2><table class="rank-table"><tbody>${rows}</tbody></table>`;
}

export function renderCardHtml(card, { seq, total, bgDataUri = null, brand = 'ECON LAB', chartLibJs = '' } = {}) {
  const isLight = card.template === 'chart' || card.template === 'table';
  const bg = bgDataUri ? `<div class="bg" style="background-image:url('${bgDataUri}')"></div>` : '';
  const iconHtml = card.icon ? `<div class="icon">${getIconSvg(card.icon, { size: 72, color: isLight ? '#12202b' : '#fff' })}</div>` : '';
  let inner = '';

  if (card.template === 'cover') {
    inner = `<h1>${esc(card.title)}</h1>${card.body ? `<p style="margin-top:50px">${esc(card.body)}</p>` : ''}`;
  } else if (card.template === 'data') {
    inner = `${iconHtml}<h2>${esc(card.title)}</h2><div class="data">${esc(card.dataLabel || '')}</div><p>${esc(card.body)}</p>`;
  } else if (card.template === 'outro') {
    inner = `<div class="outro"><h2>${esc(card.title)}</h2><p>${esc(card.body)}</p></div>`;
  } else if (card.template === 'chart') {
    inner = renderChartInner(card);
  } else if (card.template === 'table') {
    inner = renderTableInner(card);
  } else {
    inner = `${iconHtml}<h2>${esc(card.title)}</h2><p>${esc(card.body)}</p>`;
  }

  const chartScript = (card.template === 'chart' && chartLibJs) ? `<script>${chartLibJs}</script>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style>${chartScript}</head>
<body><div class="card${isLight ? ' light' : ''}">${bg}
  <div class="brand">${esc(brand)}</div>
  <div class="page">${seq} / ${total}</div>
  <div class="inner">${inner}</div>
</div>
<script>window.__ready = true;</script>
</body></html>`;
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `npm test` / Expected: PASS (기존 3개 + 신규 7개 = 10개 templates 테스트)
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: 차트/순위표/아이콘 카드 템플릿 렌더링"`

---

### Task 3: Chart.js 도입 + 렌더러 통합

**Files:**
- Modify: `package.json`
- Modify: `src/renderer/render.js`

**Interfaces:**
- Consumes: `renderCardHtml(card, { seq, total, bgDataUri, brand, chartLibJs })` (Task 2)
- Produces: `renderCards(draftId, cards, bgImages)` — 시그니처는 기존과 동일하게 유지(호출부 변경 없음). 내부적으로 `chart` 타입 카드에만 Chart.js 라이브러리를 로드해 주입하고, 모든 카드에서 `window.__ready === true`를 기다린 뒤 스크린샷.

- [ ] **Step 1: 의존성 설치**

```bash
npm install chart.js
```

- [ ] **Step 2: 실제 배포 파일명 확인**

```bash
ls node_modules/chart.js/dist/
```

Expected: `chart.umd.js` 파일이 존재해야 한다(버전에 따라 이름이 다르면 아래 코드의 파일명을 실제 이름으로 맞춘다).

- [ ] **Step 3: src/renderer/render.js 수정**

```js
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { renderCardHtml } from './templates.js';

let cachedChartLib = null;
function loadChartLib() {
  if (cachedChartLib === null) {
    const p = path.join(config.root, 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
    cachedChartLib = fs.readFileSync(p, 'utf8');
  }
  return cachedChartLib;
}

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
      const chartLibJs = cards[i].template === 'chart' ? loadChartLib() : '';
      const html = renderCardHtml(cards[i], {
        seq: i + 1, total: cards.length, bgDataUri, brand: config.brandName, chartLibJs,
      });
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__ready === true, { timeout: 5000 });
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

- [ ] **Step 4: 기존 테스트가 여전히 통과하는지 확인** — Run: `npm test` / Expected: PASS (render.js는 단위 테스트 대상이 아니므로 전체 스위트 통과만 확인)

- [ ] **Step 5: 실제 렌더링 수동 검증** — 아래 스크립트를 임시로 만들어 실행 후 삭제

```bash
cat > scripts/render-sample-v2.mjs << 'EOF'
import { renderCards } from '../src/renderer/render.js';
const paths = await renderCards('sample-v2', [
  { template: 'cover', title: '이번 주 부동산 브리핑', body: '' },
  { template: 'chart', title: '기준금리 추이', chartType: 'line', unit: '%',
    labels: ['3월', '4월', '5월', '6월', '7월'], values: [3.25, 3.0, 3.0, 2.75, 2.5] },
  { template: 'table', title: '거래량 순위 TOP3', rows: [
    { rank: 1, label: '강남구', value: '1,204건', delta: '+12' },
    { rank: 2, label: '송파구', value: '980건', delta: '-3' },
    { rank: 3, label: '서초구', value: '870건', delta: '+5' },
  ] },
  { template: 'text', title: '왜 중요할까', body: '금리 인하기에는 실수요 매수세가 붙습니다.', icon: 'trend-up' },
  { template: 'outro', title: '팔로우하고 매일 받아보세요', body: '' },
]);
console.log(paths.join('\n'));
EOF
node scripts/render-sample-v2.mjs
```

Expected: `data/images/sample-v2/card-1..5.png` 생성, 오류 없이 종료.

- [ ] **Step 6: 이미지 육안 확인** — Read 도구로 `data/images/sample-v2/card-2.png`(차트), `card-3.png`(표), `card-4.png`(아이콘)를 열어 다음을 확인:
  - 차트: 5개월치 선그래프가 흰 배경 위에 정상적으로 그려지고 숫자가 깨지지 않음
  - 표: 순위 뱃지·구 이름·거래량·증감 화살표가 흰 배경 위에 정렬됨
  - 아이콘: 텍스트 카드 제목 위에 상승 화살표 아이콘이 보임

  문제가 있으면(레이아웃 깨짐, 차트 미표시 등) `templates.js`의 CSS/스크립트를 수정하고 Step 5부터 재검증한다.

- [ ] **Step 7: 임시 스크립트 정리**

```bash
rm scripts/render-sample-v2.mjs
rmdir scripts 2>/dev/null || true
```

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: Chart.js 인라인 렌더링 통합"`

---

### Task 4: 콘텐츠 생성기 — 카드 타입 배열 기반 프롬프트

**Files:**
- Modify: `src/generator/content.js`
- Modify: `tests/content.test.js`

**Interfaces:**
- Produces:
  - `buildPrompt(sources, cardTypes = null)` — `cardTypes`가 주어지면 정확히 그 개수·순서·타입으로 카드를 만들라는 지시와 타입별 JSON 스펙을 프롬프트에 포함. 없으면 기존 자유 형식 유지.
  - `parseContent(text)` — 타입별 필드 정규화 추가(아래 규칙)
  - `generateDraftContent(sources, cardTypes = null, genFn = generateText)` — **시그니처 변경**: 기존 `(sources, genFn)`에서 `cardTypes`가 두 번째 인자로 추가됨

**parseContent 정규화 규칙:**
- `chart`: `labels`를 문자열 배열로, `values`를 숫자 배열로 강제 변환. 길이가 다르면 둘 다 빈 배열로 초기화. `chartType`은 `'bar'`가 아니면 `'line'`. `unit`은 없으면 `''`
- `table`: `rows`를 배열로 강제(아니면 `[]`), 각 행에 `rank`(없으면 순번), `label`(없으면 `''`), `value`(없으면 `''`), `delta`(없으면 `''`) 채움
- 그 외 타입(`cover`/`text`/`data`/`outro`): 기존과 동일하게 `title`/`body` 기본값 채움, `text`/`data`는 `icon` 기본값 `''`, `data`는 `dataLabel` 기본값 `''`

- [ ] **Step 1: 기존 테스트의 시그니처 변경 반영** (`tests/content.test.js`의 마지막 테스트만 아래로 교체, 나머지 기존 3개 테스트는 유지)

```js
test('generateDraftContent가 genFn 결과를 파싱해 반환', async () => {
  const c = await generateDraftContent([{ type: 'manual', title: 't', summary: '', data: null }], null, async () => SAMPLE);
  assert.equal(c.threadsText.includes('인스타그램'), true);
});
```

- [ ] **Step 2: 신규 테스트 추가** (같은 파일에 추가)

```js
test('cardTypes가 주어지면 프롬프트에 타입별 스펙이 들어간다', () => {
  const p = buildPrompt(
    [{ type: 'news', title: '금리 동결', summary: '한은…', data: null }],
    ['cover', 'chart', 'table', 'outro']
  );
  assert.ok(p.includes('정확히 4장'));
  assert.ok(p.includes('cover → chart → table → outro'));
  assert.ok(p.includes('"chartType"'));
  assert.ok(p.includes('"rows"'));
});

test('parseContent가 chart 카드의 라벨/값 길이 불일치를 빈 배열로 초기화한다', () => {
  const raw = JSON.stringify({
    caption: 'c', threadsText: 't',
    cards: [{ template: 'chart', title: '추이', labels: ['1월', '2월'], values: [1] }],
  });
  const c = parseContent(raw);
  assert.deepEqual(c.cards[0].labels, []);
  assert.deepEqual(c.cards[0].values, []);
});

test('parseContent가 chart 카드 기본값(chartType, unit)을 채운다', () => {
  const raw = JSON.stringify({
    caption: 'c', threadsText: 't',
    cards: [{ template: 'chart', title: '추이', labels: ['1월'], values: [1] }],
  });
  const c = parseContent(raw);
  assert.equal(c.cards[0].chartType, 'line');
  assert.equal(c.cards[0].unit, '');
});

test('parseContent가 table 카드의 행에 기본값을 채운다', () => {
  const raw = JSON.stringify({
    caption: 'c', threadsText: 't',
    cards: [{ template: 'table', title: '순위', rows: [{ label: '강남구', value: '10건' }] }],
  });
  const c = parseContent(raw);
  assert.equal(c.cards[0].rows[0].rank, 1);
  assert.equal(c.cards[0].rows[0].delta, '');
});

test('parseContent가 table 카드에 rows가 없으면 빈 배열로 채운다', () => {
  const raw = JSON.stringify({ caption: 'c', threadsText: 't', cards: [{ template: 'table', title: '순위' }] });
  const c = parseContent(raw);
  assert.deepEqual(c.cards[0].rows, []);
});
```

- [ ] **Step 3: 실패 확인** — Run: `npm test` / Expected: FAIL (cardTypes 미지원, chart/table 정규화 없음)

- [ ] **Step 4: src/generator/content.js 전체 교체**

```js
import { generateText } from './gemini.js';
import { config } from '../config.js';

const VALID_TEMPLATES = ['cover', 'text', 'data', 'chart', 'table', 'outro'];

const TYPE_SPEC = {
  cover: '{"template":"cover","title":"(20자 이내 강한 한 줄)","body":"(부제, 없으면 빈 문자열)"}',
  text: '{"template":"text","title":"(20자 이내)","body":"(80자 이내 설명)","icon":"(building|percent|trend-up|trend-down|coin|calendar|alert|chart 중 하나, 없으면 빈 문자열)"}',
  data: '{"template":"data","title":"(20자 이내)","dataLabel":"(핵심 수치, 예: 2.5%)","body":"(80자 이내 부연 설명)","icon":"(위와 동일한 아이콘 목록 중 선택, 없으면 빈 문자열)"}',
  chart: '{"template":"chart","title":"(20자 이내)","chartType":"line 또는 bar","labels":["항목1","항목2"],"values":[숫자,숫자],"unit":"(단위, 예: %)"}',
  table: '{"template":"table","title":"(20자 이내)","rows":[{"rank":1,"label":"이름","value":"값","delta":"+2 또는 -1 (없으면 빈 문자열)"}]}',
  outro: '{"template":"outro","title":"(20자 이내, 팔로우 유도)","body":"(80자 이내)"}',
};

export function buildPrompt(sources, cardTypes = null) {
  const srcText = sources.map((s, i) =>
    `[소스${i + 1}] (${s.type}) ${s.title}\n${s.summary || ''}\n${s.data ? 'data: ' + JSON.stringify(s.data) : ''}`
  ).join('\n\n');

  const cardInstruction = (cardTypes && cardTypes.length)
    ? `cards는 정확히 ${cardTypes.length}장이며, 순서와 타입은 반드시 다음과 같아야 한다: ${cardTypes.join(' → ')}.
각 카드의 출력 형식:
${cardTypes.map((t, i) => `${i + 1}번 카드 (${t}): ${TYPE_SPEC[t] || TYPE_SPEC.text}`).join('\n')}`
    : `cards는 4~7장: 첫 장 template "cover"(짧고 강한 한 줄 제목), 중간 "text" 또는 "data"(소스에 수치가 있을 때, dataLabel에 수치 요약), 마지막 "outro"(팔로우 유도).`;

  return `너는 데이터 카드뉴스 스타일의 한국 경제·부동산 콘텐츠 에디터다.
아래 소스를 바탕으로 카드뉴스 구성안을 JSON으로만 출력하라.
우리 브랜드명은 "${config.brandName}"이다. 다른 인스타그램 계정명(@아이디)은 절대 언급하지 마라.

${srcText}

규칙:
- 정보 전달 톤. 투자 조언·매수/매도 권유 금지.
- ${cardInstruction}
- title은 20자 이내, body는 80자 이내. 쉬운 한국어.
- chart/table 타입인데 소스에 활용할 수치·순위 데이터가 없으면 labels/values 또는 rows를 빈 배열로 둔다.
- caption: 인스타 캐프션 300자 이내 + 해시태그 8~12개.
- threadsText: 200자 이내, 핵심 요약 + "자세한 카드뉴스는 인스타그램에서 확인" 유도 문구 (계정명 없이).

출력 형식(JSON만, 다른 텍스트 금지):
{"caption":"...","cards":[...],"threadsText":"..."}`;
}

export function parseContent(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = (m ? m[1] : text).trim();
  const obj = JSON.parse(jsonStr);
  if (!obj.caption || !Array.isArray(obj.cards) || obj.cards.length < 1 || !obj.threadsText) {
    throw new Error('생성 결과에 caption/cards/threadsText가 없습니다');
  }
  for (const c of obj.cards) {
    if (!VALID_TEMPLATES.includes(c.template)) c.template = 'text';
    c.title = c.title || '';

    if (c.template === 'chart') {
      c.labels = Array.isArray(c.labels) ? c.labels.map(String) : [];
      c.values = Array.isArray(c.values) ? c.values.map(Number) : [];
      if (c.labels.length !== c.values.length) { c.labels = []; c.values = []; }
      c.chartType = c.chartType === 'bar' ? 'bar' : 'line';
      c.unit = c.unit || '';
    } else if (c.template === 'table') {
      c.rows = Array.isArray(c.rows)
        ? c.rows.map((r, i) => ({
            rank: r.rank ?? i + 1,
            label: r.label || '',
            value: r.value ?? '',
            delta: r.delta || '',
          }))
        : [];
    } else {
      c.body = c.body || '';
      if (c.template === 'text' || c.template === 'data') c.icon = c.icon || '';
      if (c.template === 'data') c.dataLabel = c.dataLabel || '';
    }
  }
  return obj;
}

export async function generateDraftContent(sources, cardTypes = null, genFn = generateText) {
  const raw = await genFn(buildPrompt(sources, cardTypes));
  return parseContent(raw);
}
```

- [ ] **Step 5: 테스트 통과 확인** — Run: `npm test` / Expected: PASS
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: 카드 타입 배열 기반 Gemini 프롬프트 + 타입별 검증"`

---

### Task 5: 서버 — cardTypes 전달

**Files:**
- Modify: `src/web/server.js`
- Modify: `tests/server.test.js`

**Interfaces:**
- Consumes: `generateDraftContent(sources, cardTypes, genFn)` (Task 4)
- Produces: `POST /api/drafts` body에 `cardTypes?: string[]` 필드 추가 지원(선택). `POST /api/drafts/:id/regenerate`는 기존 초안의 카드 타입 순서를 그대로 유지해서 재생성.

- [ ] **Step 1: 실패하는 테스트 추가** (`tests/server.test.js`에 추가 — 기존 테스트는 유지)

```js
test('cardTypes를 보내면 generateContent에 그대로 전달된다', async () => {
  const received = [];
  const db2 = openDb(':memory:');
  const app2 = createServer(db2, {
    generateContent: async (sources, cardTypes) => {
      received.push(cardTypes);
      return { caption: 'c', cards: (cardTypes || ['cover']).map(t => ({ template: t, title: 't', body: '' })), threadsText: 'th' };
    },
  });
  const srv2 = app2.listen(0);
  try {
    const base2 = `http://127.0.0.1:${srv2.address().port}`;
    const sid = db2.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    const r = await fetch(base2 + '/api/drafts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceIds: [sid], cardTypes: ['cover', 'chart', 'outro'] }),
    });
    const draft = await r.json();
    assert.deepEqual(received[0], ['cover', 'chart', 'outro']);
    assert.equal(draft.content.cards.length, 3);
  } finally { srv2.close(); }
});

test('regenerate는 기존 카드 타입 순서를 유지해서 다시 생성한다', async () => {
  const received = [];
  const db3 = openDb(':memory:');
  const app3 = createServer(db3, {
    generateContent: async (sources, cardTypes) => {
      received.push(cardTypes);
      return { caption: 'c2', cards: (cardTypes || ['cover']).map(t => ({ template: t, title: 't2', body: '' })), threadsText: 'th2' };
    },
  });
  const srv3 = app3.listen(0);
  try {
    const base3 = `http://127.0.0.1:${srv3.address().port}`;
    const sid = db3.insertSource({ type: 'manual', title: 't', url: null, summary: '', data: null });
    let r = await fetch(base3 + '/api/drafts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceIds: [sid], cardTypes: ['cover', 'table'] }),
    });
    const draft = await r.json();
    r = await fetch(base3 + `/api/drafts/${draft.id}/regenerate`, { method: 'POST' });
    await r.json();
    assert.deepEqual(received[1], ['cover', 'table']);
  } finally { srv3.close(); }
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test` / Expected: FAIL (cardTypes 무시됨)

- [ ] **Step 3: src/web/server.js의 `/api/drafts`, `/api/drafts/:id/regenerate` 라우트만 수정**

```js
  app.post('/api/drafts', async (req, res) => {
    const { sourceIds, cardTypes } = req.body;
    if (!Array.isArray(sourceIds) || !sourceIds.length) return res.status(400).json({ error: 'sourceIds 필요' });
    try {
      const sources = sourceIds.map(id => db.getSource(id)).filter(Boolean);
      if (!sources.length) return res.status(400).json({ error: '소스를 찾을 수 없습니다' });
      const types = Array.isArray(cardTypes) && cardTypes.length ? cardTypes : null;
      const content = await generateContent(sources, types);
      const draftId = db.createDraft(sourceIds);
      db.updateDraftContent(draftId, content);
      sourceIds.forEach(id => db.updateSourceStatus(id, 'used'));
      res.json(db.getDraft(draftId));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
```

```js
  app.post('/api/drafts/:id/regenerate', async (req, res) => {
    const d = db.getDraft(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'not found' });
    try {
      const sources = d.source_ids.map(id => db.getSource(id)).filter(Boolean);
      const cardTypes = d.content?.cards?.length ? d.content.cards.map(c => c.template) : null;
      const content = await generateContent(sources, cardTypes);
      db.updateDraftContent(d.id, content);
      db.updateDraftStatus(d.id, 'draft');
      res.json(db.getDraft(d.id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
```

(다른 라우트는 변경하지 않는다.)

- [ ] **Step 4: 테스트 통과 확인** — Run: `npm test` / Expected: PASS
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: 서버가 cardTypes를 초안 생성에 전달"`

---

### Task 6: 대시보드 — 카드 구성(슬롯 빌더) 화면

**Files:**
- Modify: `src/web/public/index.html`
- Modify: `src/web/public/app.js`
- Modify: `src/web/public/style.css`

**Interfaces:**
- Consumes: `POST /api/drafts` with `{ sourceIds, cardTypes }` (Task 5)
- Produces: 소스 선택 후 "카드 구성" 패널에서 슬롯(타입 배열)을 만들고 `초안 생성` 클릭 시 `cardTypes`를 포함해 `/api/drafts` 호출.

- [ ] **Step 1: index.html — 소스함 섹션에 카드 구성 패널 추가**

`src/web/public/index.html`에서 아래 블록을 찾는다:

```html
      <button id="btn-collect">🔄 지금 수집</button>
      <button id="btn-create-draft" class="primary" disabled>✍️ 선택한 소스로 콘텐츠 만들기</button>
    </div>
    <details id="manual-form">
      <summary>➕ 주제 직접 입력</summary>
      <input id="manual-title" placeholder="주제 (예: 7월 서울 아파트 거래량 급증)">
      <textarea id="manual-summary" placeholder="메모/참고 내용 (선택)"></textarea>
      <button id="btn-add-manual" class="primary">추가</button>
    </details>
    <div id="source-list" class="card-grid"></div>
  </section>
```

다음으로 교체:

```html
      <button id="btn-collect">🔄 지금 수집</button>
      <button id="btn-goto-builder" class="primary" disabled>다음: 카드 구성 →</button>
    </div>
    <details id="manual-form">
      <summary>➕ 주제 직접 입력</summary>
      <input id="manual-title" placeholder="주제 (예: 7월 서울 아파트 거래량 급증)">
      <textarea id="manual-summary" placeholder="메모/참고 내용 (선택)"></textarea>
      <button id="btn-add-manual" class="primary">추가</button>
    </details>
    <div id="source-list" class="card-grid"></div>

    <div id="card-builder" hidden>
      <button id="btn-builder-back">← 소스 다시 선택</button>
      <h2 id="builder-info"></h2>
      <p class="hint">카드마다 형태를 고르세요. Gemini가 형태에 맞춰 내용을 채워드립니다.</p>
      <div id="slot-list"></div>
      <div class="toolbar">
        <button id="btn-add-slot">+ 카드 추가</button>
        <button id="btn-generate-draft" class="primary">✍️ 초안 생성</button>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: style.css — 슬롯 빌더 스타일 추가** (파일 끝에 추가)

```css
.hint { color: #9fb0c0; font-size: 13px; margin-bottom: 14px; }
.slot-row {
  display: flex; align-items: center; gap: 10px;
  background: #16202a; border: 1px solid #26334066; border-radius: 10px;
  padding: 10px 14px; margin-bottom: 8px;
}
.slot-row select { width: auto; flex: 1; }
.slot-row button { padding: 6px 12px; }
.row-pair, .row-triple {
  display: grid; gap: 8px; align-items: center; margin-bottom: 8px;
}
.row-pair { grid-template-columns: 1fr 1fr auto; }
.row-triple { grid-template-columns: 80px 1fr 1fr 1fr auto; }
.row-add { margin: 6px 0 12px; }
.row-remove { padding: 6px 12px; background: #e0245e33; color: #ff6b8f; }
```

- [ ] **Step 3: app.js — 소스함 로직 교체** (`src/web/public/app.js`에서 아래 블록을 찾아 교체)

기존:

```js
$('#btn-create-draft').addEventListener('click', async (e) => {
  busy(e.target, true, 'Gemini 글 생성 중…');
  try {
    const draft = await api('/api/drafts', { method: 'POST', body: { sourceIds: [...selectedSources] } });
    selectedSources.clear();
    toast('초안이 생성되었습니다');
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'drafts'));
    $$('.panel').forEach(p => p.hidden = true);
    $('#tab-drafts').hidden = false;
    openDraft(draft.id);
  } catch (err) { toast(err.message, true); }
  finally { busy(e.target, false); }
});
```

다음으로 교체:

```js
const TEMPLATE_LABEL = { cover: '표지', text: '설명', data: '수치 강조', chart: '차트', table: '순위표', outro: '마무리' };
let slots = [];

function renderSlots() {
  const wrap = $('#slot-list');
  wrap.innerHTML = '';
  slots.forEach((type, i) => {
    const row = document.createElement('div');
    row.className = 'slot-row';
    row.innerHTML = `
      <span class="src-meta">카드 ${i + 1}</span>
      <select data-i="${i}">
        ${Object.entries(TEMPLATE_LABEL).map(([v, label]) => `<option value="${v}"${v === type ? ' selected' : ''}>${label}</option>`).join('')}
      </select>
      <button type="button" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" data-act="down" data-i="${i}" ${i === slots.length - 1 ? 'disabled' : ''}>↓</button>
      <button type="button" data-act="remove" data-i="${i}" ${slots.length <= 1 ? 'disabled' : ''}>삭제</button>`;
    wrap.appendChild(row);
  });
}

$('#slot-list').addEventListener('change', (e) => {
  if (e.target.tagName !== 'SELECT') return;
  slots[Number(e.target.dataset.i)] = e.target.value;
});

$('#slot-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const i = Number(btn.dataset.i);
  if (btn.dataset.act === 'remove' && slots.length > 1) slots.splice(i, 1);
  if (btn.dataset.act === 'up' && i > 0) [slots[i - 1], slots[i]] = [slots[i], slots[i - 1]];
  if (btn.dataset.act === 'down' && i < slots.length - 1) [slots[i + 1], slots[i]] = [slots[i], slots[i + 1]];
  renderSlots();
});

$('#btn-add-slot').addEventListener('click', () => { slots.push('text'); renderSlots(); });

$('#btn-goto-builder').addEventListener('click', () => {
  if (!slots.length) slots = ['cover', 'text', 'text', 'outro'];
  $('#builder-info').textContent = `카드 구성 (소스 ${selectedSources.size}개 선택됨)`;
  renderSlots();
  $('#card-builder').hidden = false;
});

$('#btn-builder-back').addEventListener('click', () => {
  $('#card-builder').hidden = true;
});

$('#btn-generate-draft').addEventListener('click', async (e) => {
  busy(e.target, true, 'Gemini 글 생성 중…');
  try {
    const draft = await api('/api/drafts', { method: 'POST', body: { sourceIds: [...selectedSources], cardTypes: slots } });
    selectedSources.clear();
    slots = [];
    $('#card-builder').hidden = true;
    toast('초안이 생성되었습니다');
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'drafts'));
    $$('.panel').forEach(p => p.hidden = true);
    $('#tab-drafts').hidden = false;
    openDraft(draft.id);
  } catch (err) { toast(err.message, true); }
  finally { busy(e.target, false); }
});
```

- [ ] **Step 4: app.js — 버튼 활성화 조건 갱신** (`loadSources` 함수 안의 `$('#btn-create-draft').disabled = ...` 줄을 찾아 교체)

```js
      $('#btn-goto-builder').disabled = selectedSources.size === 0;
```

- [ ] **Step 5: 수동 검증** — `npm start` 후 브라우저에서:
  1. 소스함에서 소스 1개 이상 체크
  2. "다음: 카드 구성 →" 클릭 → 슬롯 4개(표지/설명/설명/마무리)가 보이는지 확인
  3. 슬롯 3번을 "차트"로, 4번을 "순위표"로 바꾸고 "+ 카드 추가"로 슬롯을 하나 더 늘려본다
  4. "초안 생성" 클릭 → 초안 탭으로 이동하며 카드가 생성되는지 확인 (Gemini 키 필요)

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: 대시보드에 카드 구성(슬롯 빌더) 화면 추가"`

---

### Task 7: 대시보드 — 타입별 카드 에디터 (검수 화면)

**Files:**
- Modify: `src/web/public/app.js`
- Modify: `src/web/public/style.css`

**Interfaces:**
- Consumes: `currentDraft.content.cards[i]`가 Task 4의 타입별 데이터 구조를 따른다는 것
- Produces: `renderDraftDetail()`이 카드 타입별로 다른 편집 UI를 그리고, 입력 즉시 `currentDraft.content.cards[i]`를 직접 갱신. `collectEditedContent()`는 단순화되어 caption/threadsText만 오버레이.

- [ ] **Step 1: style.css에 카드 에디터 관련 스타일 추가** (파일 끝에 추가, Task 6의 CSS와 함께 있어도 무방)

```css
.chart-rows, .table-rows { display: flex; flex-direction: column; }
.card-editor select { margin-top: 4px; }
```

- [ ] **Step 2: app.js — `renderDraftDetail`, `collectEditedContent` 전체 교체**

기존의 `renderDraftDetail`, `collectEditedContent` 함수(그리고 그 사이에 있던 로직)를 아래로 통째로 교체한다:

```js
const ICON_OPTIONS = ['', 'building', 'percent', 'trend-up', 'trend-down', 'coin', 'calendar', 'alert', 'chart'];

function iconSelectHtml(value) {
  return `<select data-f="icon">${ICON_OPTIONS.map(v =>
    `<option value="${v}"${v === (value || '') ? ' selected' : ''}>${v || '(아이콘 없음)'}</option>`
  ).join('')}</select>`;
}

function renderChartRows(ed, c) {
  const wrap = ed.querySelector('.chart-rows');
  const labels = c.labels || [];
  const values = c.values || [];
  wrap.innerHTML = '';
  const len = Math.max(labels.length, values.length, 1);
  for (let r = 0; r < len; r++) {
    const row = document.createElement('div');
    row.className = 'row-pair';
    row.innerHTML = `
      <input placeholder="라벨" data-row="${r}" data-part="label">
      <input placeholder="값" type="number" data-row="${r}" data-part="value">
      <button type="button" class="row-remove" data-row="${r}">✕</button>`;
    row.querySelector('[data-part="label"]').value = labels[r] || '';
    row.querySelector('[data-part="value"]').value = values[r] ?? '';
    wrap.appendChild(row);
  }
}

function renderTableRows(ed, c) {
  const wrap = ed.querySelector('.table-rows');
  const rows = c.rows || [];
  wrap.innerHTML = '';
  rows.forEach((r, idx) => {
    const row = document.createElement('div');
    row.className = 'row-triple';
    row.innerHTML = `
      <input placeholder="순위" type="number" data-row="${idx}" data-part="rank">
      <input placeholder="이름" data-row="${idx}" data-part="label">
      <input placeholder="값" data-row="${idx}" data-part="value">
      <input placeholder="증감 (+2, -1)" data-row="${idx}" data-part="delta">
      <button type="button" class="row-remove" data-row="${idx}">✕</button>`;
    row.querySelector('[data-part="rank"]').value = r.rank ?? idx + 1;
    row.querySelector('[data-part="label"]').value = r.label || '';
    row.querySelector('[data-part="value"]').value = r.value ?? '';
    row.querySelector('[data-part="delta"]').value = r.delta || '';
    wrap.appendChild(row);
  });
}

function buildCardEditor(c, i) {
  const ed = document.createElement('div');
  ed.className = 'card-editor';
  ed.dataset.i = i;

  if (c.template === 'chart') {
    ed.innerHTML = `
      <label>카드 ${i + 1} · ${TEMPLATE_LABEL[c.template]}</label>
      <input data-f="title" placeholder="제목">
      <div class="chart-rows"></div>
      <button type="button" class="row-add" data-kind="chart">+ 항목 추가</button>
      <select data-f="chartType"><option value="line">선 그래프</option><option value="bar">막대 그래프</option></select>
      <input data-f="unit" placeholder="단위 (예: %)">`;
    ed.querySelector('[data-f="title"]').value = c.title || '';
    ed.querySelector('[data-f="chartType"]').value = c.chartType || 'line';
    ed.querySelector('[data-f="unit"]').value = c.unit || '';
    renderChartRows(ed, c);
  } else if (c.template === 'table') {
    ed.innerHTML = `
      <label>카드 ${i + 1} · ${TEMPLATE_LABEL[c.template]}</label>
      <input data-f="title" placeholder="제목">
      <div class="table-rows"></div>
      <button type="button" class="row-add" data-kind="table">+ 행 추가</button>`;
    ed.querySelector('[data-f="title"]').value = c.title || '';
    renderTableRows(ed, c);
  } else {
    ed.innerHTML = `
      <label>카드 ${i + 1} · ${TEMPLATE_LABEL[c.template] || c.template}</label>
      <input data-f="title" placeholder="제목">
      <textarea data-f="body" rows="2" placeholder="본문"></textarea>
      ${c.template === 'data' ? `<input data-f="dataLabel" placeholder="수치 (예: 2.5%)">` : ''}
      ${(c.template === 'text' || c.template === 'data') ? iconSelectHtml(c.icon) : ''}`;
    ed.querySelector('[data-f="title"]').value = c.title || '';
    ed.querySelector('[data-f="body"]').value = c.body || '';
    const dl = ed.querySelector('[data-f="dataLabel"]');
    if (dl) dl.value = c.dataLabel || '';
  }

  ed.querySelectorAll('[data-f]').forEach(el => {
    el.addEventListener('input', () => { currentDraft.content.cards[i][el.dataset.f] = el.value; });
  });

  return ed;
}

function renderDraftDetail() {
  const d = currentDraft;
  $('#draft-status').innerHTML = `<span class="badge st-${d.status}">${ST_LABEL[d.status] || d.status}</span> <span class="src-meta">초안 #${d.id}</span>`;
  const wrap = $('#card-editors');
  wrap.innerHTML = '';
  (d.content?.cards || []).forEach((c, i) => wrap.appendChild(buildCardEditor(c, i)));
  $('#ed-caption').value = d.content?.caption || '';
  $('#ed-threads').value = d.content?.threadsText || '';
  $('#btn-publish').disabled = d.status !== 'images_ready';
  $('#publish-result').innerHTML = '';
}

$('#card-editors').addEventListener('click', (e) => {
  const addBtn = e.target.closest('.row-add');
  const rmBtn = e.target.closest('.row-remove');
  if (!addBtn && !rmBtn) return;
  const ed = e.target.closest('.card-editor');
  const i = Number(ed.dataset.i);
  const c = currentDraft.content.cards[i];

  if (addBtn) {
    if (addBtn.dataset.kind === 'chart') {
      c.labels = c.labels || []; c.values = c.values || [];
      c.labels.push(''); c.values.push(0);
      renderChartRows(ed, c);
    } else {
      c.rows = c.rows || [];
      c.rows.push({ rank: c.rows.length + 1, label: '', value: '', delta: '' });
      renderTableRows(ed, c);
    }
  } else if (rmBtn) {
    const r = Number(rmBtn.dataset.row);
    if (c.template === 'chart') { c.labels.splice(r, 1); c.values.splice(r, 1); renderChartRows(ed, c); }
    else { c.rows.splice(r, 1); renderTableRows(ed, c); }
  }
});

$('#card-editors').addEventListener('input', (e) => {
  const part = e.target.dataset.part;
  if (!part) return;
  const ed = e.target.closest('.card-editor');
  const i = Number(ed.dataset.i);
  const r = Number(e.target.dataset.row);
  const c = currentDraft.content.cards[i];
  if (c.template === 'chart') {
    if (part === 'label') c.labels[r] = e.target.value;
    if (part === 'value') c.values[r] = Number(e.target.value);
  } else if (c.template === 'table') {
    c.rows[r] = { ...c.rows[r], [part]: part === 'rank' ? Number(e.target.value) : e.target.value };
  }
});

function collectEditedContent() {
  return { ...currentDraft.content, caption: $('#ed-caption').value, threadsText: $('#ed-threads').value };
}
```

- [ ] **Step 3: 수동 검증** — `npm start` 후:
  1. Task 6에서 chart/table 슬롯을 포함해 만든 초안을 연다
  2. 차트 카드 편집기에서 "+ 항목 추가"로 행을 늘리고 라벨/값을 입력 → 값이 반영되는지 확인
  3. 표 카드 편집기에서 행 추가/삭제, 순위·이름·값·증감 입력 확인
  4. text/data 카드에서 아이콘 드롭다운 선택 확인
  5. [저장] 클릭 후 새로고침(페이지 재방문) → 값이 유지되는지 확인

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: 차트/표/아이콘 타입별 카드 검수 에디터"`

---

### Task 8: 엔드투엔드 수동 검증

- [ ] **Step 1**: 대시보드에서 실제 소스(예: 기준금리 추이가 담긴 `realestate` 타입 소스, 또는 증시 스냅샷)를 선택
- [ ] **Step 2**: 카드 구성에서 `cover, chart, table, text, outro` 슬롯 구성 (표 데이터가 없는 소스라면 `table` 대신 `data`로 대체)
- [ ] **Step 3**: 초안 생성 → Gemini가 채운 chart/table 데이터가 실제 소스 수치와 합리적으로 일치하는지 검수 화면에서 확인, 필요하면 직접 수정
- [ ] **Step 4**: [글 확정] → [이미지 생성] → 카드 미리보기에서 차트/표/아이콘이 정상적으로 렌더링되는지 확인
- [ ] **Step 5**: 문제 없으면 이번 세션에서는 배포까지는 하지 않고 종료 (배포는 사용자가 검수 후 직접 클릭)

---

## Self-Review 결과

- **스펙 커버리지**: 6종 카드 타입=Task 2 · 흰 배경 차트/표=Task 2 · Gemini 카드 슬롯 지시=Task 4 · 사람이 형태 직접 선택=Task 6 · Gemini 초안+사람 수정=Task 4(생성)+Task 7(수정) · 지도 제외=범위에서 명시적으로 뺌.
- **타입 일관성**: `card.template` 값(`cover/text/data/chart/table/outro`)이 `templates.js`(렌더링) → `content.js`(생성·검증) → `app.js`(편집 UI) 전체에서 동일한 문자열로 사용됨. `chart`의 `labels/values/chartType/unit`, `table`의 `rows[{rank,label,value,delta}]` 필드명이 세 파일 모두 일치.
- **회귀 방지**: 기존 `cover/text/data/outro` 카드는 배경·필드가 그대로 유지되고(다크 그라데이션, Gemini 배경 이미지 대상), `renderCardHtml`/`generateDraftContent`의 기본 인자(`chartLibJs=''`, `cardTypes=null`)로 인해 카드 타입을 지정하지 않는 기존 경로도 계속 동작함.
- **수동 검증 지점**: Chart.js 실제 렌더링(Task 3)과 대시보드 UI 동작(Task 6, 7)은 자동 테스트로 완전히 커버되지 않으므로 각 태스크에 스크린샷/브라우저 수동 확인 스텝을 명시함.
