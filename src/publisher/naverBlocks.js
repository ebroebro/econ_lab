// 블로그 본문(마커 포함 텍스트)과 카드 이미지 경로 배열을, 네이버 블로그 MCP가 순서대로
// 재생할 blocks로 변환한다. 참조: naver-blog-writer의 buildBlocks/splitBody 패턴.
const DIVIDER_TOKEN = '[구분선]';
const QUOTE_RE = /\[인용구\]([\s\S]*?)\[\/인용구\]/;
const PHOTO_RE = /\[사진(\d+)\]/g;

// 본문을 [사진N] 기준으로 잘라 text/image 세그먼트로 나눈다. 매핑되는 이미지가 없는
// [사진N]은 마커만 제거하고 앞뒤 텍스트를 이어붙여, 의도치 않은 문단 분리를 막는다.
function splitByPhotos(body, imagePaths) {
  const segments = [];
  let buf = '';
  let last = 0;
  let m;
  PHOTO_RE.lastIndex = 0;
  while ((m = PHOTO_RE.exec(body))) {
    buf += body.slice(last, m.index);
    last = m.index + m[0].length;
    const path = imagePaths[Number(m[1]) - 1];
    if (path) {
      if (buf) { segments.push({ type: 'text', text: buf }); buf = ''; }
      segments.push({ type: 'image', path });
    }
    // path가 없으면 마커만 삼키고 buf는 계속 이어붙인다(주변 텍스트 연속 유지).
  }
  buf += body.slice(last);
  if (buf) segments.push({ type: 'text', text: buf });
  return segments;
}

export function buildBlocks(body, imagePaths = []) {
  const blocks = [];

  const pushDivider = () => {
    if (blocks.length === 0) return;              // 선두 구분선 금지
    if (blocks.at(-1)?.type === 'divider') return; // 연속 구분선 금지
    blocks.push({ type: 'divider' });
  };

  const pushTextWithDividers = (text) => {
    const parts = text.split(DIVIDER_TOKEN);
    parts.forEach((part, i) => {
      if (i > 0) pushDivider();
      if (part.trim().length === 0) return;
      blocks.push({ type: 'text', text: part });
    });
  };

  for (const seg of splitByPhotos(body, imagePaths)) {
    if (seg.type === 'image') { blocks.push(seg); continue; }
    let remaining = seg.text;
    let match;
    while ((match = QUOTE_RE.exec(remaining))) {
      pushTextWithDividers(remaining.slice(0, match.index));
      const quoteText = match[1].trim();
      if (quoteText.length > 0) blocks.push({ type: 'quote', text: quoteText });
      remaining = remaining.slice(match.index + match[0].length);
    }
    pushTextWithDividers(remaining);
  }

  while (blocks.at(-1)?.type === 'divider') blocks.pop(); // 말미 구분선 제거
  return blocks;
}
