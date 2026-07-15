# 소스함 주제별 그룹핑 + 오늘의 추천 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소스함(`#tab-sources`) 목록을 "청약/부동산정책/미국주식/국내주식/금리·환율/기타" 주제 소제목으로 묶어서 보여주고, 카테고리마다 맨 위(최신) 2개 소스에 "⭐ 오늘의 추천" 배지를 붙인다.

**Architecture:** 순수 프런트엔드 변경. 백엔드(`server.js`, `db.js`, collectors)는 건드리지 않는다. `src/web/public/app.js`에 키워드 규칙 테이블과 `classifySource()` 순수 함수를 추가하고, 기존 `loadSources()`의 평면 카드 렌더링을 "카테고리별 섹션 → 카드 그리드" 렌더링으로 바꾼다. 서버 응답이 이미 최신순으로 정렬돼 오므로 그룹핑 후에도 카테고리 내부 순서는 그대로 유지되고, 그 순서의 맨 위 2개가 곧 "최신 2개"다.

**Tech Stack:** 기존 vanilla JS(`src/web/public/app.js`, 빌드 스텝 없음), CSS.

## Global Constraints

- 백엔드(`server.js`, `db.js`, `src/collectors/*`)와 DB 스키마는 변경하지 않는다 — 분류는 클라이언트가 이미 받은 `title`/`summary`로만 한다.
- 새 API 호출(Gemini 등)을 추가하지 않는다.
- 기존 "전체 유형" 드롭다운 필터(`#src-type-filter`, 뉴스/부동산/증시/직접 입력)의 동작은 그대로 유지한다 — 그 필터를 통과한 결과 안에서 다시 주제별로 묶는다.
- 카드 클릭 → 다중 선택 토글 동작(`selectedSources`, `#btn-goto-builder`/`#btn-story-mode` 활성화)은 기존과 동일하게 유지한다.
- 이 프런트엔드(`src/web/public/*`)는 자동 테스트 스위트가 없다(기존 관례) — 이번 작업도 자동 테스트를 새로 만들지 않고 브라우저 수동 확인으로 검증한다.
- Node ESM 백엔드 코드 스타일과 달리 `app.js`는 빌드 스텝 없는 classic script이므로 기존 파일의 함수 선언 스타일(화살표 함수 `const`, 최상단 상수)을 그대로 따른다.

---

## File Structure

- **Modify `src/web/public/app.js`** — `TOPIC_RULES` 상수, `classifySource(source)` 함수, `buildSourceCard(source, recommended)` 함수(기존 `loadSources()` 안의 카드 생성 로직을 추출) 추가. `loadSources()`를 그룹핑 렌더링으로 교체.
- **Modify `src/web/public/style.css`** — `.source-group`, `.source-group-title`, `.badge.recommend` 스타일 추가.

---

### Task 1: 소스함 주제별 그룹핑 + 추천 배지

**Files:**
- Modify: `src/web/public/app.js:50-85` (기존 `TYPE_LABEL` 상수와 `loadSources()` 함수 전체 교체)
- Modify: `src/web/public/style.css` (파일 끝에 규칙 추가)

**Interfaces:**
- Produces (내부 함수, 다른 파일에서 쓰지 않음): `classifySource(source): string`(카테고리 key 반환), `buildSourceCard(source, recommended): HTMLElement`.
- Consumes: 기존 `TYPE_LABEL`, `selectedSources`(Set), `api()`(기존 fetch 헬퍼) — 모두 이미 `app.js`에 있음.

- [ ] **Step 1: `app.js`의 `TYPE_LABEL` 상수 바로 아래에 카테고리 규칙 테이블과 분류 함수 추가**

`src/web/public/app.js`의 `const TYPE_LABEL = { news: '뉴스', realestate: '부동산', stock: '증시', manual: '직접 입력' };` 줄(현재 51번째 줄) 바로 아래에 추가:

```js
// 소스 제목+요약을 우선순위 순서로 키워드 매칭해 세분화된 주제로 묶는다. DB/서버 변경 없이
// 화면에서만 그룹핑한다 — 더 구체적인 카테고리(청약)를 일반적인 카테고리(부동산정책)보다 먼저 검사.
const TOPIC_RULES = [
  { key: 'subscription', label: '청약', patterns: [/청약/, /분양/, /입주자모집/, /특별공급/, /당첨/] },
  { key: 'realestate_policy', label: '부동산정책', patterns: [/규제/, /DSR/, /대출/, /재건축/, /재개발/, /종부세/, /재산세/, /공급대책/, /토론회/] },
  { key: 'us_stock', label: '미국주식', patterns: [/미국/, /나스닥/, /다우/, /S&P/, /연준/, /Fed/, /파월/, /ADR/, /월가/] },
  { key: 'kr_stock', label: '국내주식', patterns: [/코스피/, /코스닥/, /삼성전자/, /하이닉스/, /특징주/, /상한가/, /실적/, /증권/] },
  { key: 'rate_fx', label: '금리·환율', patterns: [/기준금리/, /환율/, /원\/달러/, /한은/, /금통위/] },
  { key: 'etc', label: '기타', patterns: [] },
];

function classifySource(source) {
  const text = `${source.title || ''} ${source.summary || ''}`;
  for (const rule of TOPIC_RULES) {
    if (rule.patterns.length === 0) return rule.key; // 마지막 규칙(기타)은 항상 매치되는 폴백
    if (rule.patterns.some((re) => re.test(text))) return rule.key;
  }
  return 'etc';
}
```

- [ ] **Step 2: 기존 `loadSources()`의 카드 생성 로직을 `buildSourceCard()`로 추출**

`src/web/public/app.js`의 기존 `loadSources()` 함수(현재 53-83번째 줄) 전체를 아래로 교체:

```js
function buildSourceCard(s, recommended) {
  const card = document.createElement('div');
  card.className = 'src-card' + (selectedSources.has(s.id) ? ' selected' : '');
  card.innerHTML = `
    <div class="src-head">
      <span class="badge ${s.type}">${TYPE_LABEL[s.type] || s.type}</span>
      ${recommended ? '<span class="badge recommend">⭐ 오늘의 추천</span>' : ''}
      <span class="src-meta">${s.collected_at || ''}</span>
    </div>
    <div class="src-title"></div>
    <div class="src-summary"></div>`;
  card.querySelector('.src-title').textContent = s.title;
  card.querySelector('.src-summary').textContent = s.summary || '';
  card.addEventListener('click', () => {
    if (selectedSources.has(s.id)) selectedSources.delete(s.id);
    else selectedSources.add(s.id);
    card.classList.toggle('selected');
    $('#btn-goto-builder').disabled = selectedSources.size === 0;
    $('#btn-story-mode').disabled = selectedSources.size === 0;
  });
  return card;
}

async function loadSources() {
  const type = $('#src-type-filter').value;
  const sources = await api(`/api/sources?status=new${type ? `&type=${type}` : ''}`);
  const list = $('#source-list');
  list.innerHTML = '';
  if (!sources.length) {
    list.innerHTML = '<p style="color:#5c6b7a">소스가 없습니다. [지금 수집]을 누르거나 주제를 직접 입력하세요.</p>';
    return;
  }

  // 서버가 이미 collected_at DESC로 정렬해 보내므로, 그룹핑 후에도 카테고리 안의 순서는
  // 최신순을 유지한다 — 그래서 각 그룹의 앞쪽 2개가 곧 "최신 2개"다.
  const groups = new Map(TOPIC_RULES.map((r) => [r.key, []]));
  for (const s of sources) groups.get(classifySource(s)).push(s);

  for (const rule of TOPIC_RULES) {
    const items = groups.get(rule.key);
    if (!items.length) continue;
    const section = document.createElement('div');
    section.className = 'source-group';
    section.innerHTML = `<h3 class="source-group-title">${rule.label}</h3>`;
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    items.forEach((s, i) => grid.appendChild(buildSourceCard(s, i < 2)));
    section.appendChild(grid);
    list.appendChild(section);
  }
}
```

- [ ] **Step 3: CSS 추가**

`src/web/public/style.css` 파일 끝에 추가:

```css
.source-group { margin-bottom: 6px; }
.source-group-title {
  font-size: 15px; color: #9fb0c0; margin: 18px 0 8px;
  border-bottom: 1px solid #26334066; padding-bottom: 6px;
}
.badge.recommend { background: #ffd60a33; color: #ffd60a; }
```

- [ ] **Step 4: 수동 확인 — 그룹핑·추천 배지 렌더링**

```bash
npm test
```
Expected: 기존 백엔드 테스트 전부 PASS(이 태스크는 백엔드를 건드리지 않으므로 회귀 없어야 함).

`npm start` 후 대시보드를 열어(또는 이미 실행 중이면 새로고침) "소스함" 탭에서 다음을 확인:
- 소스들이 "청약"/"부동산정책"/"미국주식"/"국내주식"/"금리·환율"/"기타" 소제목 아래로 나뉘어 보인다.
- 소스가 없는 카테고리는 소제목 자체가 안 보인다.
- 각 카테고리 맨 위 최대 2장에 "⭐ 오늘의 추천" 배지가 보인다.
- 카드 클릭 시 선택(하이라이트) 토글과 "다음: 카드 구성 →"/"📖 스토리 공식으로 생성" 버튼 활성화가 기존과 동일하게 동작한다.
- "전체 유형" 드롭다운으로 필터링하면 그 결과 안에서만 다시 그룹핑된다.

- [ ] **Step 5: 커밋**

```bash
git add src/web/public/app.js src/web/public/style.css
git commit -m "feat(sources): 소스함을 주제별로 그룹핑하고 오늘의 추천 배지 추가"
```

---

## Self-Review

- **Spec 커버리지:** 분류 규칙(6개 카테고리, 우선순위 순서)=Step 1, UI 그룹핑 렌더링·필터와의 관계 유지·선택 동작 유지=Step 2, 추천 배지(카테고리당 최대 2개)=Step 2, 스타일=Step 3, 검증=Step 4. 범위 밖(Gemini 분류, DB 컬럼, 커스터마이징 UI)은 애초에 계획에 포함하지 않음. ✅
- **Placeholder 스캔:** 모든 스텝에 실제 코드 포함. "TBD"/"TODO" 없음. ✅
- **타입 일관성:** `classifySource(source)`가 반환하는 key(`subscription`/`realestate_policy`/`us_stock`/`kr_stock`/`rate_fx`/`etc`)가 `TOPIC_RULES`의 `key`/`label`과 `loadSources()`의 `groups` Map 키로 정확히 일치. `buildSourceCard(s, recommended)`의 두 번째 인자가 `loadSources()`에서 `i < 2`로 넘겨지는 boolean과 일치. ✅
