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
