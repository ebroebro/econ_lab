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

// only: 지정하면 해당 인덱스의 카드만 렌더링한다(예: AI 이미지 생성이 실패한 카드만 HTML 폴백 렌더).
// 반환값은 항상 cards.length 길이의 배열이며, 렌더링하지 않은 인덱스는 undefined로 남는다.
export async function renderCards(draftId, cards, { only = null } = {}) {
  const dir = path.join(config.imagesDir, String(draftId));
  fs.mkdirSync(dir, { recursive: true });
  const indices = only ? only : cards.map((_, i) => i);
  const paths = new Array(cards.length);
  if (!indices.length) return paths;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  try {
    for (const i of indices) {
      const chartLibJs = cards[i].template === 'chart' ? loadChartLib() : '';
      const html = renderCardHtml(cards[i], {
        seq: i + 1, total: cards.length, brand: config.brandName, chartLibJs,
      });
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__ready === true, { timeout: 5000 });
      const file = path.join(dir, `card-${i + 1}.png`);
      await page.screenshot({ path: file });
      paths[i] = file;
    }
  } finally {
    await browser.close();
  }
  return paths;
}
