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

function topElements(seq, total) {
  const parts = [
    `Layout grid: apply a consistent, generous outer margin on all four sides of the canvas, the same margin width used for the top-left badge, the top-right badge, and the body content below — never a tighter or wider margin for one corner than the other.`,
    `Top-left corner badge: a small square badge with rounded corners, black fill, positioned right at the top-left corner touching the standard outer margin (not floating further inward), bold white number "${seq}" centered inside. Keep this badge the same compact size on every card — about one-fifteenth of the canvas width, never larger or smaller.`,
    `Top-right corner badge: a pill shape, white background, thin black border, fully rounded ends, positioned right at the top-right corner touching the standard outer margin, vertically centered with the top-left badge (same horizontal center line), bold black text "MARKET BRIEF" in a single line (do not wrap onto two lines). Keep this pill the same compact height on every card, sized to snugly fit the text with modest horizontal padding — never larger, never wrapping.`,
  ];
  if (seq === 1 && total > 1) {
    parts.push('Swipe indicator: a small pill badge, black background, white bold text "Swipe →", positioned directly beneath the MARKET BRIEF pill with a small consistent gap, right-edge aligned with it.');
  }
  return parts.join('\n');
}

function footerBar(handle) {
  return `Bottom bar: a full-width horizontal bar with a light gray background and a thin border along its top edge only, spanning the entire width of the canvas and touching the very bottom edge with zero gap below it (no white margin beneath it). Keep this bar a fixed, compact height — just tall enough for one or two lines of small text — the same height on every card, never taller or shorter. Content sits inside this bar with the same horizontal margin as the rest of the layout. Left-aligned: a small lightbulb icon plus small bold dark gray Korean text "투자 유의" followed by smaller gray Korean text "본 콘텐츠는 정보 제공 목적이며, 투자 판단의 최종 책임은 투자자 본인에게 있습니다.". Right-aligned, vertically centered in the bar: small bold black text "${handle}". No other element (illustration, chart, table, flowchart, body text) may overlap or extend into this bottom bar. Do not render any pixel measurements, coordinates, rulers, or numeric labels anywhere on the image — these are internal layout notes only, never visible text.`;
}

function tagLine(tag) {
  if (!tag || !tag.text) return '';
  const color = tag.color === 'red' ? 'red' : 'blue';
  return `Small rounded ${color} badge with white bold text "${tag.text}", placed below the top badges.`;
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
    topElements(seq, total),
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

  parts.push(footerBar(handle));
  parts.push(NO_HALLUCINATION_GUARD);
  return parts.filter(Boolean).join('\n');
}

export async function generateCardImage(card, { brand = 'ECON LAB', seq = 1, total = 1, handle = '@econ_lab_kr', imageFn = generateImage } = {}) {
  try {
    return await imageFn(buildCardImagePrompt(card, { brand, seq, total, handle }));
  } catch (e) {
    console.error('[aiCard] 카드 이미지 생성 실패:', e.message);
    return null;
  }
}
