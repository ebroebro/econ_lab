import { generateImage } from '../generator/gemini.js';

const STYLE_BLOCK = `Modern editorial financial infographic card, Instagram post, 1080x1350 portrait, no watermark, no mockup, no extra decorations.
Style: Bloomberg + Apple + Notion. Premium infographic, minimal design, flat vector illustration, corporate luxury editorial.
White background, bold black Korean typography, red accent color, plenty of white space, high readability, balanced layout, professional financial graphic.
All Korean text and numbers must render exactly as given, sharp and legible, no garbled or malformed characters, no altered/rounded/hallucinated digits.`;

const NO_HALLUCINATION_GUARD = `STRICT TEXT RULE: Render ONLY the text pieces explicitly quoted in this prompt, each exactly once. Do not invent, add, duplicate, repeat, or overlay any additional Korean text, captions, subtitles, or paragraphs beyond what is explicitly quoted above. If no body/subtitle text is quoted, leave that area empty — do not make up filler text. The headline must appear exactly ONCE as a single text block — never render it twice, never render it at two different sizes, never add a second smaller headline-style phrase near it.`;

function headlineLine(title, { size = 'large' } = {}) {
  return `Headline in ${size} bold black Korean text (single line/block, exactly once, no second headline nearby): "${title}"`;
}

const ROLE_ILLUSTRATION = {
  hook: 'a minimal flat vector illustration of a magnifying glass over a stock chart line, red accent',
  cause: 'a minimal flat vector illustration relevant to the cause described in the title, red or black accent',
  marketImpact: 'a minimal flat vector illustration of a stock chart line trending sharply, red accent',
  koreaImpact: 'a minimal flat vector illustration of a simplified Korea map or building skyline silhouette, red accent',
  checklist: 'a minimal flat vector illustration of a checklist or clipboard icon, black accent',
  summary: 'a minimal flat vector illustration of a flag or bookmark icon marking a summary, red accent',
};

function safeZones() {
  return `Leave two rectangular safe zones completely empty (plain white background, no text, no illustration, no decorative element, no border, no outline, no line, no shape of any kind — nothing at all, not even faint or partial marks): a full-width horizontal strip along the very TOP edge of the canvas, about one-tenth of the canvas height, and a full-width horizontal strip along the very BOTTOM edge, about one-twelfth of the canvas height. All actual content (tag badge, source line, headline, body, illustration, chart, table, flowchart) must start below the top strip and end above the bottom strip. These two strips are reserved for elements added separately after this image is generated — keep them perfectly clear. Do not render any pixel measurements, coordinates, rulers, or numeric layout labels anywhere on the image — these are internal notes only, never visible text.
Do NOT draw any numbered badge, page number, slide number, step counter, or any standalone number-in-a-shape indicator anywhere on the image — this card is part of a numbered carousel but the number is added separately after generation, so the image itself must contain zero page/slide numbers.`;
}

function tagLine(tag) {
  if (!tag || !tag.text) return '';
  const color = tag.color === 'red' ? 'red' : 'blue';
  return `Small rounded ${color} badge with white bold text "${tag.text}", placed in the upper area, above the headline.`;
}

function sourceLine(source) {
  return source ? `Small gray text above the headline: "${source}"` : '';
}

function flowchartBlock(steps, conclusion, conclusionColor) {
  const chain = steps.map((s, i) => `${i + 1}) "${s}"`).join(' then a downward arrow (↓) then ');
  const concl = conclusion
    ? ` Below the last step, a downward arrow (↓) leading to a wide highlighted box with ${conclusionColor} background and bold white Korean text: "${conclusion}".`
    : '';
  return `Below the headline, draw a vertical flowchart of small rounded rectangle boxes, each containing a small relevant flat icon on the left and bold black Korean text on the right, connected by downward arrows (↓) in this exact order: ${chain}.${concl} Each box text must match exactly, one phrase per box, no extra boxes.`;
}

function statsBlock(stats) {
  const [a, b] = stats;
  return `Below the headline, draw two side-by-side rounded rectangle boxes of equal size. Left box: small icon, bold black Korean label "${a.label}", and large bold black number "${a.value}" below it. Right box: small icon, bold black Korean label "${b.label}", and large bold black number "${b.value}" below it. Use red text for negative values, blue for positive.`;
}

export function buildCardImagePrompt(card, { brand = 'ECON LAB', seq = 1, total = 1, handle = '@econ_lab_kr' } = {}) {
  const parts = [
    STYLE_BLOCK,
    safeZones(),
    tagLine(card.tag),
    sourceLine(card.source),
  ];

  if (card.template === 'chart') {
    const hasData = Array.isArray(card.labels) && Array.isArray(card.values)
      && card.labels.length > 0 && card.labels.length === card.values.length;
    parts.push(headlineLine(card.title));
    if (hasData) {
      const points = card.labels.map((l, i) => `${l}: ${card.values[i]}`).join(', ');
      parts.push(`Below the headline, draw a clean ${card.chartType === 'bar' ? 'bar' : 'line'} chart (blue accent, light blue gradient fill for line charts) with these exact data points in order: ${points}.${card.unit ? ` Unit: ${card.unit}.` : ''} Add small bold black value labels near each point/bar showing the exact numbers, no rounding.`);
    } else {
      parts.push('No data available — show the headline only with generous white space below.');
    }
  } else if (card.template === 'table') {
    parts.push(headlineLine(card.title));
    const hasColumns = Array.isArray(card.columns) && card.columns.length > 0;
    if (hasColumns) {
      const header = card.columns.join(' | ');
      const rows = (card.rows || []).map((r) => r.join(' | ')).join('\n');
      parts.push(`Below the headline, draw a clean bordered data table with a dark navy header row (white bold text) with rounded corners and subtle shadow. Columns: ${header}. Rows exactly as follows (numbers pixel-perfect, no rounding):\n${rows}\nColor any negative/percentage-decline values in red, positive in blue.`);
    } else {
      const rows = (card.rows || []).map((r, i) => `${r.rank ?? i + 1}. ${r.label} — ${r.value} (${r.delta || ''})`).join('\n');
      parts.push(`Below the headline, draw a clean ranked list with circular rank badges. Rows:\n${rows}\nColor negative deltas red, positive blue.`);
    }
  } else if (card.template === 'data') {
    parts.push(headlineLine(card.title));
    const color = card.dataColor === 'red' ? 'red' : card.dataColor === 'blue' ? 'blue' : 'black';
    parts.push(`Below the headline, a very large bold ${color} number/text as the hero stat: "${card.dataLabel}". Exact digits, no rounding.`);
    if (card.body) parts.push(`Small gray supporting text below the stat: "${card.body}"`);
    if (Array.isArray(card.rows) && card.rows.length) {
      const rows = card.rows.map((r) => `${r.label}: ${r.value}`).join(', ');
      parts.push(`Below that, a simple borderless list of label/value pairs: ${rows}.`);
    }
  } else if (card.template === 'subscription') {
    parts.push(headlineLine(card.title));
    if (card.region) parts.push(`Small gray text below the headline: "${card.region}"`);
    parts.push(`Below that, a very large bold black number/text as the hero stat: "${card.totalSupply}". Exact digits, no rounding.`);
    const rows = `청약접수: ${card.receiptStart || ''} ~ ${card.receiptEnd || ''}, 당첨자발표: ${card.winnerDate || ''}`;
    parts.push(`Below that, a simple borderless list of label/value pairs: ${rows}.`);
  } else if (card.template === 'cover') {
    if (card.meta) parts.push(`Small gray text above the headline: "${card.meta}"`);
    parts.push(headlineLine(card.title, { size: 'very large, top third of the image' }));
    if (card.body) parts.push(`Subtitle below in medium gray Korean text (a separate, distinct sentence from the headline): "${card.body}"`);
    parts.push('Right side or lower area: minimal flat vector illustration matching the headline topic, red accent.');
  } else if (card.template === 'outro') {
    parts.push(headlineLine(card.title));
    if (card.body) parts.push(`Supporting gray Korean text below (a separate, distinct sentence from the headline): "${card.body}"`);
  } else {
    // text (일반 설명 카드, story-mode role 카드 포함)
    parts.push(headlineLine(card.title, { size: 'large, upper area' }));

    const hasSteps = Array.isArray(card.steps) && card.steps.length > 0;
    const hasStats = Array.isArray(card.stats) && card.stats.length === 2;

    if (hasSteps) {
      parts.push(flowchartBlock(card.steps, card.conclusion, card.tag?.color === 'red' ? 'red' : 'black'));
      if (card.body) parts.push(`Below the flowchart, small gray Korean supporting text (a separate, distinct sentence, not one of the flowchart boxes): "${card.body}"`);
    } else if (hasStats) {
      parts.push(statsBlock(card.stats));
      if (card.body) parts.push(`Below the boxes, small gray Korean supporting text: "${card.body}"`);
    } else if (Array.isArray(card.bullets) && card.bullets.length) {
      parts.push(`As a checklist with a small checkmark icon before each line, one item per line, each line exactly: ${card.bullets.join(' / ')}`);
    } else if (card.body) {
      parts.push(`Body text below in dark gray Korean, medium size (a separate, distinct sentence from the headline): "${card.body}"`);
    }

    if (!hasSteps && !hasStats) {
      const illo = ROLE_ILLUSTRATION[card.role] || ROLE_ILLUSTRATION.cause;
      parts.push(`Lower-right or bottom area: ${illo}.`);
    }
  }

  parts.push(NO_HALLUCINATION_GUARD);
  return parts.filter(Boolean).join('\n');
}

// seq/total/handle은 프롬프트에는 더 이상 쓰이지 않지만(번호배지·MARKET BRIEF·푸터는 이제 프레임 합성 단계에서
// 코드로 그려진다), 호출부가 그대로 넘겨도 되도록 시그니처를 유지한다.
export async function generateCardImage(card, { brand = 'ECON LAB', seq = 1, total = 1, handle = '@econ_lab_kr', imageFn = generateImage } = {}) {
  try {
    return await imageFn(buildCardImagePrompt(card, { brand, seq, total, handle }));
  } catch (e) {
    console.error('[aiCard] 카드 이미지 생성 실패:', e.message);
    return null;
  }
}
