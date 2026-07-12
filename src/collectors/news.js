import Parser from 'rss-parser';

// 경제·부동산 섹션 RSS (수집 실패 시 해당 피드만 건너뜀)
export const FEEDS = [
  { name: '한국경제 경제', url: 'https://www.hankyung.com/feed/economy' },
  { name: '한국경제 부동산', url: 'https://www.hankyung.com/feed/realestate' },
  { name: '매일경제 경제', url: 'https://www.mk.co.kr/rss/30100041/' },
  { name: '매일경제 부동산', url: 'https://www.mk.co.kr/rss/50300009/' },
  { name: '연합뉴스 경제', url: 'https://www.yna.co.kr/rss/economy.xml' },
];

export async function collectNews(db, parser = new Parser({ timeout: 15000 })) {
  let saved = 0;
  for (const feed of FEEDS) {
    try {
      const res = await parser.parseURL(feed.url);
      for (const item of (res.items || []).slice(0, 20)) {
        if (!item.title || !item.link) continue;
        db.insertSource({
          type: 'news',
          title: item.title.trim(),
          url: item.link,
          summary: (item.contentSnippet || '').slice(0, 500),
          data: { feed: feed.name, pubDate: item.pubDate || null },
        });
        saved++;
      }
    } catch (e) {
      console.error(`[collect:news] ${feed.name} 실패:`, e.message);
    }
  }
  return saved;
}
