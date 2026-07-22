import { config } from '../config.js';

const T = 'https://graph.threads.net/v1.0';

// 컨테이너 생성 → 발행 → permalink 조회 3단계. replyToId가 있으면 그 글에 답글로 붙는다.
// 답글에는 이미지를 붙이지 않는다는 전제로, imageUrl은 루트 글 호출 때만 넘어온다.
async function publishOnePost({ text, imageUrl, replyToId, threadsUserId, threadsAccessToken, fetchFn }) {
  const enc = encodeURIComponent;
  const parts = imageUrl
    ? [`media_type=IMAGE`, `image_url=${enc(imageUrl)}`, `text=${enc(text)}`]
    : [`media_type=TEXT`, `text=${enc(text)}`];
  if (replyToId) parts.push(`reply_to_id=${enc(replyToId)}`);
  const mediaParams = parts.join('&');

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

export async function publishToThreads({ text, imageUrl = null }, fetchFn = fetch, creds = config.meta) {
  const { threadsUserId, threadsAccessToken } = creds;
  if (!threadsUserId || !threadsAccessToken) throw new Error('THREADS_USER_ID / THREADS_ACCESS_TOKEN을 .env에 설정하세요');

  if (!Array.isArray(text)) {
    return publishOnePost({ text, imageUrl, replyToId: null, threadsUserId, threadsAccessToken, fetchFn });
  }

  // 배열이면 실제 '쓰레드'로 발행한다: 첫 글만 이미지를 붙이고, 나머지는 이전 글에
  // reply_to_id로 답글을 이어 붙인다. 체인 중간에 실패하면 예외를 던진다(이미 발행된
  // 글은 남지만 이 함수는 부분 성공을 별도로 알리지 않는다 — 호출부가 기존 발행 실패와
  // 동일하게 처리한다).
  const posts = text.map(String).map((s) => s.trim()).filter(Boolean);
  const root = await publishOnePost({ text: posts[0], imageUrl, replyToId: null, threadsUserId, threadsAccessToken, fetchFn });
  let lastId = root.id;
  for (const post of posts.slice(1)) {
    const reply = await publishOnePost({ text: post, imageUrl: null, replyToId: lastId, threadsUserId, threadsAccessToken, fetchFn });
    lastId = reply.id;
  }
  return root;
}
