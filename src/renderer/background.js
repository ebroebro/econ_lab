import { generateImage } from '../generator/gemini.js';

export function buildBgPrompt(card) {
  return `Abstract professional background image for a Korean finance/real-estate news card about "${card.title}". Dark navy and teal gradient mood, subtle geometric shapes or city skyline silhouette, premium editorial style. IMPORTANT: no text, no letters, no numbers, no watermarks. 4:5 portrait.`;
}

export async function generateBackgrounds(cards, imageFn = generateImage) {
  const out = {};
  for (let i = 0; i < cards.length; i++) {
    const t = cards[i].template;
    if (t !== 'cover' && t !== 'data') continue;
    try {
      const buf = await imageFn(buildBgPrompt(cards[i]));
      if (buf) out[i] = buf;
    } catch (e) {
      console.error(`[background] 카드 ${i} 배경 생성 실패:`, e.message);
    }
  }
  return out;
}
