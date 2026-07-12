import { generateText } from './gemini.js';
import { config } from '../config.js';

export function buildPrompt(sources) {
  const srcText = sources.map((s, i) =>
    `[소스${i + 1}] (${s.type}) ${s.title}\n${s.summary || ''}\n${s.data ? 'data: ' + JSON.stringify(s.data) : ''}`
  ).join('\n\n');
  return `너는 데이터 카드뉴스 스타일의 한국 경제·부동산 콘텐츠 에디터다.
아래 소스를 바탕으로 카드뉴스 구성안을 JSON으로만 출력하라.
우리 브랜드명은 "${config.brandName}"이다. 다른 인스타그램 계정명(@아이디)은 절대 언급하지 마라.

${srcText}

규칙:
- 정보 전달 톤. 투자 조언·매수/매도 권유 금지.
- cards는 4~7장: 첫 장 template "cover"(짧고 강한 한 줄 제목), 중간 "text" 또는 "data"(소스에 수치가 있을 때, dataLabel에 수치 요약), 마지막 "outro"(팔로우 유도).
- title은 20자 이내, body는 80자 이내. 쉬운 한국어.
- caption: 인스타 캐프션 300자 이내 + 해시태그 8~12개.
- threadsText: 200자 이내, 핵심 요약 + "자세한 카드뉴스는 인스타그램에서 확인" 유도 문구 (계정명 없이).

출력 형식(JSON만, 다른 텍스트 금지):
{"caption":"...","cards":[{"template":"cover","title":"...","body":"","dataLabel":""}],"threadsText":"..."}`;
}

export function parseContent(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = (m ? m[1] : text).trim();
  const obj = JSON.parse(jsonStr);
  if (!obj.caption || !Array.isArray(obj.cards) || obj.cards.length < 1 || !obj.threadsText) {
    throw new Error('생성 결과에 caption/cards/threadsText가 없습니다');
  }
  for (const c of obj.cards) {
    if (!['cover', 'text', 'data', 'outro'].includes(c.template)) c.template = 'text';
    c.title = c.title || '';
    c.body = c.body || '';
  }
  return obj;
}

export async function generateDraftContent(sources, genFn = generateText) {
  const raw = await genFn(buildPrompt(sources));
  return parseContent(raw);
}
