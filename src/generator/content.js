import { generateText } from './gemini.js';
import { config } from '../config.js';

const VALID_TEMPLATES = ['cover', 'text', 'data', 'chart', 'table', 'outro'];
const TAG_COLORS = ['blue', 'red'];

const TYPE_SPEC = {
  cover: '{"template":"cover","title":"(강력한 헤드라인, 20자 이내, 숫자·고유명사 포함 권장)","meta":"(날짜·공고일 등 부제, 없으면 빈 문자열)","tag":{"text":"(카테고리 라벨, 예: 청약정보·긴급속보, 없으면 null)","color":"blue 또는 red"},"body":""}',
  text: '{"template":"text","title":"(20자 이내 소제목)","bullets":["(핵심 포인트 1개씩, 각 30자 이내, 2~5개)"],"body":"","icon":"(building|percent|trend-up|trend-down|coin|calendar|alert|chart 중 택1, 없으면 빈 문자열)","tag":null,"source":"(수치를 인용했다면 출처, 없으면 빈 문자열)"}',
  data: '{"template":"data","title":"(수치가 무엇인지 20자 이내)","dataLabel":"(핵심 숫자 그 자체, 예: 1,495원 또는 2.5%)","dataColor":"red(위험·하락·경고) 또는 blue(중립·정보) 또는 black","rows":[{"label":"세부 항목명","value":"값"}],"body":"","icon":"","tag":null,"source":"(출처, 예: * 출처: 한국은행 2026.7.13)"}',
  chart: '{"template":"chart","title":"(20자 이내)","chartType":"line 또는 bar","labels":["항목1","항목2"],"values":[숫자,숫자],"unit":"(단위, 예: %)","tag":null,"source":""}',
  table: '{"template":"table","title":"(20자 이내)","columns":["열 이름1","열 이름2","열 이름3"],"rows":[["셀","셀","셀"],["셀","셀","셀"]],"tag":null,"source":"(출처)"}',
  outro: '{"template":"outro","title":"(팔로우 유도, 20자 이내)","body":"(80자 이내)","tag":null}',
};

export function buildPrompt(sources, cardTypes = null) {
  const srcText = sources.map((s, i) =>
    `[소스${i + 1}] (${s.type}) ${s.title}\n${s.summary || ''}\n${s.data ? 'data: ' + JSON.stringify(s.data) : ''}`
  ).join('\n\n');

  const cardInstruction = (cardTypes && cardTypes.length)
    ? `cards는 최대 ${cardTypes.length}장이며, 순서와 타입은 다음과 같다: ${cardTypes.join(' → ')}. 단, 소스 내용이 부족해 같은 내용을 다른 표현으로 반복하게 될 것 같으면 뒤쪽 카드부터 생략해 개수를 줄인다(무리하게 채우지 않는다).
각 카드의 출력 형식:
${cardTypes.map((t, i) => `${i + 1}번 카드 (${t}): ${TYPE_SPEC[t] || TYPE_SPEC.text}`).join('\n')}`
    : `cards는 내용에 필요한 만큼만 만든다(보통 1~4장, 정보가 짧으면 1장도 충분하다 — 억지로 늘리지 않는다). 수치·순위 데이터가 있으면 "data"나 "table"을, 추이가 있으면 "chart"를 적극 사용한다. 표지("cover")는 선택이며 본문 카드 하나로 헤드라인+표까지 다 담아도 된다.`;

  return `너는 10년 이상 경력의 한국 경제·부동산 데이터 카드뉴스 에디터다. 실제 업계 계정(부동산 정보 카드뉴스)처럼 정보 밀도가 높고 한눈에 읽히는 콘텐츠를 만든다.

디자인 원칙(반드시 지킬 것):
- 장식적인 문장이나 감상 없이, 숫자·표·핵심 사실 위주로 압축한다.
- 헤드라인은 짧고 강하게. 가능하면 구체적 숫자를 헤드라인에 넣는다(예: "코스피 7천 붕괴" O, "증시가 흔들리고 있습니다" X).
- 소스에 있는 실제 수치는 반올림하지 말고 그대로 인용하고, 인용했다면 source 필드에 출처를 짧게 적는다(예: "* 출처: 연합뉴스"). 출처가 불분명하면 source는 빈 문자열로 둔다.
- 비교·순위·항목이 3개 이상이면 "table"에 columns를 채워 표로 정리한다. 단순 강조 수치 하나면 "data"를 쓴다.
- tag는 이 카드의 성격을 한 단어로 압축한 라벨이다(예: "긴급속보", "청약정보", "금리동향"). 애매하면 null로 둔다.
- 절대 과장하거나 확정되지 않은 걸 단정하지 않는다. 정보 전달 톤. 투자 조언·매수/매도 권유 금지.

아래 소스를 바탕으로 카드뉴스 구성안을 JSON으로만 출력하라.
우리 브랜드명은 "${config.brandName}"이다. 다른 인스타그램 계정명(@아이디)은 절대 언급하지 마라.

${srcText}

규칙:
- ${cardInstruction}
- title은 20자 이내. 쉬운 한국어.
- chart/table 타입인데 소스에 활용할 수치·순위 데이터가 없으면 labels/values 또는 columns/rows를 빈 배열로 둔다.
- caption: 인스타 캐프션 300자 이내 + 해시태그 8~12개.
- threadsText: 200자 이내, 핵심 요약 + "자세한 카드뉴스는 인스타그램에서 확인" 유도 문구 (계정명 없이).

출력 형식(JSON만, 다른 텍스트 금지):
{"caption":"...","cards":[...],"threadsText":"..."}`;
}

function normalizeTag(tag) {
  if (!tag || typeof tag !== 'object' || !tag.text) return null;
  return { text: String(tag.text), color: TAG_COLORS.includes(tag.color) ? tag.color : 'blue' };
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
    c.tag = normalizeTag(c.tag);
    c.source = c.source ? String(c.source) : '';

    if (c.template === 'chart') {
      c.labels = Array.isArray(c.labels) ? c.labels.map(String) : [];
      c.values = Array.isArray(c.values) ? c.values.map(Number) : [];
      if (c.labels.length !== c.values.length) { c.labels = []; c.values = []; }
      c.chartType = c.chartType === 'bar' ? 'bar' : 'line';
      c.unit = c.unit || '';
    } else if (c.template === 'table') {
      const hasColumns = Array.isArray(c.columns) && c.columns.length > 0;
      if (hasColumns) {
        c.columns = c.columns.map(String);
        c.rows = Array.isArray(c.rows)
          ? c.rows.map((r) => {
              const arr = Array.isArray(r) ? r.map(String) : [];
              while (arr.length < c.columns.length) arr.push('');
              return arr.slice(0, c.columns.length);
            })
          : [];
      } else {
        c.columns = [];
        c.rows = Array.isArray(c.rows)
          ? c.rows.map((r, i) => ({
              rank: r.rank ?? i + 1,
              label: r.label || '',
              value: r.value ?? '',
              delta: r.delta || '',
            }))
          : [];
      }
    } else if (c.template === 'data') {
      c.body = c.body || '';
      c.icon = c.icon || '';
      c.dataLabel = c.dataLabel || '';
      c.dataColor = ['red', 'blue'].includes(c.dataColor) ? c.dataColor : 'black';
      c.rows = Array.isArray(c.rows)
        ? c.rows.map((r) => ({ label: r.label || '', value: r.value ?? '' }))
        : [];
    } else if (c.template === 'text') {
      c.body = c.body || '';
      c.icon = c.icon || '';
      c.bullets = Array.isArray(c.bullets) ? c.bullets.map(String).filter(Boolean) : [];
    } else if (c.template === 'cover') {
      c.body = c.body || '';
      c.meta = c.meta ? String(c.meta) : '';
    } else {
      c.body = c.body || '';
    }
  }
  return obj;
}

export async function generateDraftContent(sources, cardTypes = null, genFn = generateText) {
  const raw = await genFn(buildPrompt(sources, cardTypes));
  return parseContent(raw);
}

const STORY_ROLES = ['hook', 'cause', 'marketImpact', 'koreaImpact', 'checklist', 'summary'];

// STEP1(기사 분석) + STEP2(스토리 기획) 공식: 궁금증 → 원인(1~3개) → 시장 영향 → 한국 영향 → 체크리스트 → 요약.
// 소스가 빈약하면 원인/영향 카드를 줄여 전체 3~10장 사이에서 유동적으로 구성한다.
export function buildStoryPrompt(sources) {
  const srcText = sources.map((s, i) =>
    `[소스${i + 1}] (${s.type}) ${s.title}\n${s.summary || ''}\n${s.data ? 'data: ' + JSON.stringify(s.data) : ''}`
  ).join('\n\n');

  return `너는 아래 5가지 역할을 동시에 수행하는 전문가다: 15년 경력 경제 기자, 월가 베테랑 증권 애널리스트, 블룸버그 스타일 콘텐츠 에디터, 인스타그램 카드뉴스 기획자, 프리미엄 인포그래픽 디자이너.
목표는 뉴스 요약이 아니라 "왜 이런 일이 발생했고 무엇을 이해해야 하는가"를 가장 쉽고 직관적으로 전달하는 것이다.

## STEP1 — 기사 분석 (내부적으로 수행, 출력하지 않음)
아래 소스들을 모두 분석해 공통된 핵심 원인을 파악하라. 소스 하나만 보고 결론 내리지 마라.

${srcText}

## STEP2 — 스토리 기획 (이 구조를 그대로 cards 배열로 출력)
사람들이 끝까지 넘겨보게 만드는 스토리로 구성한다. 카드 순서와 역할(role)은 다음과 같다:
1. role "hook": 궁금증을 유발하는 도입 (예: "오늘 코스피에 무슨 일이?")
2. role "cause": 핵심 원인 1개당 카드 1장. 소스에서 실제로 확인되는 원인만 쓰고, 없는 원인을 지어내지 않는다(보통 1~3장).
3. role "marketImpact": 시장 전체에 미친 영향
4. role "koreaImpact": 한국 시장·투자자에 미치는 영향 (소스에 근거가 있을 때만 포함, 없으면 생략 가능)
5. role "checklist": 앞으로 체크할 변수 목록 (예: 미국채 금리, 유가, 환율, 실적발표 등 — 실제 관련된 것만)
6. role "summary": 한 장 요약 (핵심을 다시 압축)

전체 카드 수는 소스가 풍부하면 8~10장, 소스가 짧거나 원인이 적으면 무리하게 늘리지 말고 4~6장으로 줄인다. 억지 카드 생성 금지.

각 카드는 다음 JSON 형식이다:
{"template":"text","role":"hook|cause|marketImpact|koreaImpact|checklist|summary","title":"(20자 이내 소제목)","body":"(60~100자, 쉬운 한국어, 경제를 잘 몰라도 이해 가능해야 함)","oneLiner":"(이 카드의 30자 이내 한 줄 요약)","tag":{"text":"카테고리 라벨","color":"blue 또는 red"},"source":"(수치를 인용했다면 출처, 없으면 빈 문자열)","steps":["(인과관계 흐름 단계, 각 10~15자, 2~4개. cause/marketImpact/koreaImpact처럼 원인→결과 흐름이 있는 카드에만 채운다. 없으면 빈 배열)"],"conclusion":"(steps의 최종 결론을 한 문장으로, 예: 반도체 집중 매도. steps가 없으면 빈 문자열)","stats":[{"label":"비교 대상1(예: 외국인)","value":"수치(예: -4,147억)"},{"label":"비교 대상2(예: 기관)","value":"수치"}]}
- steps/conclusion: 이 카드가 원인→결과의 인과 흐름을 설명한다면(주로 cause, marketImpact, koreaImpact) 채운다. 없으면 둘 다 비워둔다.
- stats: 소스에 정확히 비교 가능한 수치 2개(예: 외국인 vs 기관 매도액, 코스피 vs 코스닥)가 있을 때만 채운다. 없으면 빈 배열.

## 콘텐츠 원칙
- 기사를 그대로 복사하지 않는다. 팩트와 의견을 명확히 구분한다.
- 추측은 반드시 "가능성이 있다"는 식으로 표현한다. 과장하거나 클릭 유도용 허위 문구를 쓰지 않는다.
- 숫자는 소스와 동일하게 사용한다(반올림·창작 금지).
- 복잡한 경제 용어는 쉽게 풀어 설명한다. 투자 조언·매수매도 권유 금지.
- 우리 브랜드명은 "${config.brandName}"이다. 다른 인스타그램 계정명은 언급하지 않는다.

## 출력
- caption: 인스타 캐프션 300자 이내 + 해시태그 8~12개.
- threadsText: 200자 이내, 핵심 요약 + "자세한 카드뉴스는 인스타그램에서 확인" 유도 문구 (계정명 없이).

출력 형식(JSON만, 다른 텍스트 금지):
{"caption":"...","cards":[...],"threadsText":"..."}`;
}

export function parseStoryContent(text) {
  const obj = parseContent(text);
  for (const c of obj.cards) {
    c.role = STORY_ROLES.includes(c.role) ? c.role : 'cause';
    c.oneLiner = c.oneLiner ? String(c.oneLiner) : '';
    c.steps = Array.isArray(c.steps) ? c.steps.map(String).filter(Boolean).slice(0, 4) : [];
    c.conclusion = c.steps.length ? String(c.conclusion || '') : '';
    c.stats = Array.isArray(c.stats) && c.stats.length === 2
      ? c.stats.map((s) => ({ label: String(s?.label || ''), value: String(s?.value ?? '') }))
      : [];
  }
  return obj;
}

export async function generateStoryDraft(sources, genFn = generateText) {
  const raw = await genFn(buildStoryPrompt(sources));
  return parseStoryContent(raw);
}

// 카드 스토리를 재료로 네이버 블로그 전용 본문을 생성한다. 카드 이미지 N장을 [사진1..N]
// 마커로 본문 흐름에 끼워 넣게 하고, 섹션 전환에는 [구분선], 핵심 수치 강조에는
// [인용구]...[/인용구]를 쓰게 한다(publisher/naverBlocks.js가 이 마커들을 해석).
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
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
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
