import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
html,body { width:800px; height:800px; }
.wrap {
  width:800px; height:800px; display:flex; flex-direction:column;
  align-items:center; justify-content:center;
  background:linear-gradient(160deg,#0f2027,#203a43 50%,#2c5364);
  font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif; color:#fff;
}
.mark {
  width:180px; height:180px; border-radius:50%; border:6px solid #fff;
  display:flex; align-items:center; justify-content:center; margin-bottom:36px;
}
.mark svg { width:96px; height:96px; }
h1 { font-size:64px; font-weight:800; letter-spacing:4px; }
p { font-size:26px; opacity:.75; margin-top:14px; letter-spacing:2px; }
</style></head>
<body><div class="wrap">
  <div class="mark">
    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="3 17 9 11 13 15 21 6"></polyline>
      <polyline points="15 6 21 6 21 12"></polyline>
    </svg>
  </div>
  <h1>ECON LAB</h1>
  <p>DATA &amp; ECONOMY</p>
</div></body></html>`;

const outDir = path.join(process.cwd(), 'data', 'brand');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'profile-logo.png');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.screenshot({ path: outPath });
await browser.close();

console.log(outPath);
