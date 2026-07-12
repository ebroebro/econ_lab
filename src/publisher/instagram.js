import { config } from '../config.js';

// Instagram API with Instagram Login (graph.instagram.com) — Facebook 페이지 연결 없이
// Instagram 계정으로 직접 발급받은 토큰을 사용하는 최신 방식.
const G = 'https://graph.instagram.com/v21.0';

async function call(fetchFn, url, step) {
  const res = await fetchFn(url, { method: 'POST' });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(`[instagram:${step}] ${j.error?.message || res.status}`);
  return j;
}

export async function publishToInstagram({ imageUrls, caption }, fetchFn = fetch, creds = config.meta) {
  const { igUserId, igAccessToken } = creds;
  if (!igUserId || !igAccessToken) throw new Error('IG_USER_ID / IG_ACCESS_TOKEN을 .env에 설정하세요');
  const enc = encodeURIComponent;
  let creationId;

  if (imageUrls.length === 1) {
    const c = await call(fetchFn,
      `${G}/${igUserId}/media?image_url=${enc(imageUrls[0])}&caption=${enc(caption)}&access_token=${igAccessToken}`, 'container');
    creationId = c.id;
  } else {
    const children = [];
    for (const u of imageUrls) {
      const c = await call(fetchFn,
        `${G}/${igUserId}/media?image_url=${enc(u)}&is_carousel_item=true&access_token=${igAccessToken}`, 'child');
      children.push(c.id);
    }
    const carousel = await call(fetchFn,
      `${G}/${igUserId}/media?media_type=CAROUSEL&children=${children.join(',')}&caption=${enc(caption)}&access_token=${igAccessToken}`, 'carousel');
    creationId = carousel.id;
  }

  const pub = await call(fetchFn, `${G}/${igUserId}/media_publish?creation_id=${creationId}&access_token=${igAccessToken}`, 'publish');
  const permRes = await fetchFn(`${G}/${pub.id}?fields=permalink&access_token=${igAccessToken}`);
  const perm = await permRes.json();
  return { id: pub.id, permalink: perm.permalink || null };
}
