// 한국은행 ECOS 통계: 722Y001 = 한국은행 기준금리 (월)
export async function collectRealEstate(db, apiKey, fetchFn = fetch) {
  if (!apiKey) return 0;
  try {
    const end = new Date();
    const start = new Date(end.getFullYear() - 1, end.getMonth(), 1);
    const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    const url = `https://ecos.bok.or.kr/api/StatisticSearch/${apiKey}/json/kr/1/100/722Y001/M/${fmt(start)}/${fmt(end)}/0101000`;
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`ECOS HTTP ${res.status}`);
    const j = await res.json();
    const rows = j?.StatisticSearch?.row || [];
    if (!rows.length) return 0;
    const rates = rows.map(r => ({ time: r.TIME, value: Number(r.DATA_VALUE) }));
    const latest = rates[rates.length - 1];
    db.insertSource({
      type: 'realestate',
      title: `한국은행 기준금리 ${latest.value}% (${latest.time.slice(0, 4)}.${latest.time.slice(4)})`,
      url: `ecos://base-rate/${latest.time}`,
      summary: '최근 12개월 기준금리 추이',
      data: { rates },
    });
    return 1;
  } catch (e) {
    console.error('[collect:realestate] 실패:', e.message);
    return 0;
  }
}
