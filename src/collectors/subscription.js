// 공공데이터포털 "한국부동산원_청약홈_APT 분양정보" API. 별도 날짜 필터가 없어 매번 최신
// perPage(100)건을 가져오고, 공고마다 고유한 모집공고홈페이지주소를 url로 저장해
// db.insertSource의 url 유니크 인덱스로 중복 수집을 방지한다.
const ODCLOUD_URL = 'https://api.odcloud.kr/api/15101046/v1/uddi:14a46595-03dd-47d3-a418-d64e52820598';

export async function collectSubscriptions(db, apiKey, fetchFn = fetch) {
  if (!apiKey) return 0;
  try {
    const url = `${ODCLOUD_URL}?page=1&perPage=100&returnType=JSON&serviceKey=${encodeURIComponent(apiKey)}`;
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`odcloud HTTP ${res.status}`);
    const j = await res.json();
    const items = j?.data || [];

    let saved = 0;
    for (const item of items) {
      if (!item?.주택명 || !item?.모집공고홈페이지주소) continue;
      const region = item.공급지역명 || '';
      const totalSupply = Number(item.공급규모) || 0;
      const receiptStart = item.청약접수시작일 || '';
      const receiptEnd = item.청약접수종료일 || '';
      const winnerDate = item.당첨자발표일 || '';
      const noticeDate = item.모집공고일 || '';
      db.insertSource({
        type: 'subscription',
        title: item.주택명,
        url: item.모집공고홈페이지주소,
        summary: `${region} · 총 ${totalSupply}세대 · 접수 ${receiptStart}~${receiptEnd}`,
        data: { region, totalSupply, receiptStart, receiptEnd, winnerDate, noticeDate },
      });
      saved++;
    }
    return saved;
  } catch (e) {
    console.error('[collect:subscription] 실패:', e.message);
    return 0;
  }
}
