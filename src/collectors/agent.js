import cron from 'node-cron';
import { collectNews } from './news.js';
import { collectStocks } from './stocks.js';
import { collectRealEstate } from './realestate.js';
import { collectSubscriptions } from './subscription.js';
import { config } from '../config.js';

export async function runAllCollectors(db) {
  const [news, stocks, realestate, subscription] = await Promise.all([
    collectNews(db),
    collectStocks(db),
    collectRealEstate(db, config.ecosApiKey),
    collectSubscriptions(db, config.dataGoKrApiKey),
  ]);
  console.log(`[agent] 수집 완료 — 뉴스 ${news}, 증시 ${stocks}, 부동산 ${realestate}, 청약 ${subscription}`);
  return { news, stocks, realestate, subscription };
}

export function startAgent(db) {
  cron.schedule('*/30 * * * *', () => collectNews(db));                                 // 뉴스: 30분마다
  cron.schedule('5 9-16 * * 1-5', () => collectStocks(db));                             // 증시: 평일 장중 매시 5분
  cron.schedule('0 8 * * *', () => collectRealEstate(db, config.ecosApiKey));           // 공공: 매일 08:00
  cron.schedule('30 8 * * *', () => collectSubscriptions(db, config.dataGoKrApiKey));   // 청약: 매일 08:30
  runAllCollectors(db).catch(e => console.error('[agent] 초기 수집 실패:', e.message));
  console.log('[agent] 백그라운드 수집 에이전트 시작');
}
