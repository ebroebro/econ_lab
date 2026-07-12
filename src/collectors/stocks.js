const NAVER = 'https://m.stock.naver.com/api/index';

function num(s) { return s == null ? null : Number(String(s).replace(/,/g, '')); }

async function fetchIndex(fetchFn, code) {
  const res = await fetchFn(`${NAVER}/${code}/basic`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${code} HTTP ${res.status}`);
  const j = await res.json();
  return { value: num(j.closePrice), change: num(j.compareToPreviousClosePrice), changeRate: num(j.fluctuationsRatio) };
}

export async function collectStocks(db, fetchFn = fetch) {
  try {
    const [kospi, kosdaq] = await Promise.all([
      fetchIndex(fetchFn, 'KOSPI'),
      fetchIndex(fetchFn, 'KOSDAQ'),
    ]);
    const now = new Date();
    const stamp = now.toISOString().slice(0, 16).replace('T', ' ');
    db.insertSource({
      type: 'stock',
      title: `증시 스냅샷 ${stamp}`,
      url: null,
      summary: `코스피 ${kospi.value} (${kospi.changeRate}%) / 코스닥 ${kosdaq.value} (${kosdaq.changeRate}%)`,
      data: { kospi, kosdaq, collectedAt: now.toISOString() },
    });
    return 1;
  } catch (e) {
    console.error('[collect:stocks] 실패:', e.message);
    return 0;
  }
}
