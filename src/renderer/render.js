import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { renderCardHtml } from './templates.js';

export async function renderCards(draftId, cards, bgImages = {}) {
  const dir = path.join(config.imagesDir, String(draftId));
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  const paths = [];
  try {
    for (let i = 0; i < cards.length; i++) {
      const bgBuf = bgImages[i];
      const bgDataUri = bgBuf ? `data:image/png;base64,${bgBuf.toString('base64')}` : null;
      const html = renderCardHtml(cards[i], { seq: i + 1, total: cards.length, bgDataUri });
      await page.setContent(html, { waitUntil: 'networkidle' });
      const file = path.join(dir, `card-${i + 1}.png`);
      await page.screenshot({ path: file });
      paths.push(file);
    }
  } finally {
    await browser.close();
  }
  return paths;
}
