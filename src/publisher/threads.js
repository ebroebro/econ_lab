import { config } from '../config.js';

const T = 'https://graph.threads.net/v1.0';

export async function publishToThreads({ text, imageUrl = null }, fetchFn = fetch, creds = config.meta) {
  const { threadsUserId, threadsAccessToken } = creds;
  if (!threadsUserId || !threadsAccessToken) throw new Error('THREADS_USER_ID / THREADS_ACCESS_TOKEN을 .env에 설정하세요');
  const enc = encodeURIComponent;

  const mediaParams = imageUrl
    ? `media_type=IMAGE&image_url=${enc(imageUrl)}&text=${enc(text)}`
    : `media_type=TEXT&text=${enc(text)}`;
  let res = await fetchFn(`${T}/${threadsUserId}/threads?${mediaParams}&access_token=${threadsAccessToken}`, { method: 'POST' });
  let j = await res.json();
  if (!res.ok || j.error) throw new Error(`[threads:container] ${j.error?.message || res.status}`);

  res = await fetchFn(`${T}/${threadsUserId}/threads_publish?creation_id=${j.id}&access_token=${threadsAccessToken}`, { method: 'POST' });
  const pub = await res.json();
  if (!res.ok || pub.error) throw new Error(`[threads:publish] ${pub.error?.message || res.status}`);

  const permRes = await fetchFn(`${T}/${pub.id}?fields=permalink&access_token=${threadsAccessToken}`);
  const perm = await permRes.json();
  return { id: pub.id, permalink: perm.permalink || null };
}
