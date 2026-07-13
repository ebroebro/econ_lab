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

export async function renderCards(draftId, cards) {
  const dir = path.join(config.imagesDir, String(draftId));
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  const paths = [];
  try {
    for (let i = 0; i < cards.length; i++) {
      const chartLibJs = cards[i].template === 'chart' ? loadChartLib() : '';
      const html = renderCardHtml(cards[i], {
        seq: i + 1, total: cards.length, brand: config.brandName, chartLibJs,
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
