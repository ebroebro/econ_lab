import { chromium } from 'playwright';

const FRAME_CSS = `
* { margin:0; padding:0; box-sizing:border-box; }
html,body { width:1080px; height:1350px; overflow:hidden; font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif; }
.frame { position:relative; width:1080px; height:1350px; }
.frame img.base { position:absolute; inset:0; width:1080px; height:1350px; object-fit:cover; display:block; }
.top-mask { position:absolute; top:0; left:0; width:1080px; height:140px; background:#fff; }
.brief-pill { position:absolute; top:60px; right:60px; height:56px; padding:0 28px; border-radius:28px;
  background:#fff; border:2px solid #14181c; display:flex; align-items:center; justify-content:center;
  font-weight:800; font-size:24px; color:#14181c; white-space:nowrap; }
.swipe-pill { position:absolute; top:128px; right:60px; height:48px; padding:0 22px; border-radius:24px;
  background:#14181c; display:flex; align-items:center; justify-content:center;
  font-weight:800; font-size:20px; color:#fff; white-space:nowrap; }
.footer-bar { position:absolute; left:0; right:0; bottom:0; height:110px; background:#f2f2f2;
  border-top:1px solid #e2e2e2; display:flex; align-items:center; justify-content:space-between;
  padding:0 60px; }
.footer-left { display:flex; align-items:center; gap:10px; font-size:20px; color:#5c6b7a; font-weight:600; max-width:760px; }
.footer-left b { color:#333; font-weight:800; white-space:nowrap; }
.footer-handle { font-weight:800; font-size:22px; color:#14181c; white-space:nowrap; }
`;

// AI가 생성한 카드 이미지(base) 위에 번호 없는 고정 프레임(MARKET BRIEF 라벨, Swipe 안내, 하단 디스클레이머)을
// 코드로 합성한다. 프롬프트만으로는 매번 위치·크기가 미세하게 달라지는 문제가 있어, 이 요소들은 CSS로 고정한다.
export function buildFrameHtml(imageBase64, { seq = 1, total = 1, handle = '@econ_lab_kr' } = {}) {
  const showSwipe = seq === 1 && total > 1;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FRAME_CSS}</style></head>
<body>
  <div class="frame">
    <img class="base" src="data:image/png;base64,${imageBase64}" />
    <div class="top-mask"></div>
    <div class="brief-pill">MARKET BRIEF</div>
    ${showSwipe ? '<div class="swipe-pill">Swipe &rarr;</div>' : ''}
    <div class="footer-bar">
      <div class="footer-left">💡 <span><b>투자 유의</b> 본 콘텐츠는 정보 제공 목적이며, 투자 판단의 최종 책임은 투자자 본인에게 있습니다.</span></div>
      <div class="footer-handle">${handle}</div>
    </div>
  </div>
  <script>window.__ready = true;</script>
</body></html>`;
}

// items: [{ buf, seq, total, handle }, ...] (희소 배열 가능, undefined 항목은 건너뛴다)
// 반환값은 items와 같은 길이의 배열이며, 처리하지 않은 인덱스는 undefined로 남는다.
export async function compositeCardFrames(items) {
  const results = new Array(items.length);
  const indices = items.map((it, i) => (it ? i : -1)).filter((i) => i >= 0);
  if (!indices.length) return results;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  try {
    for (const i of indices) {
      const it = items[i];
      const html = buildFrameHtml(it.buf.toString('base64'), it);
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__ready === true, { timeout: 5000 });
      results[i] = await page.screenshot();
    }
  } finally {
    await browser.close();
  }
  return results;
}
