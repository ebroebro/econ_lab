// 네이버 블로그 포스팅은 30초~2분 + CAPTCHA 수동 대응 가능성이 있어 동기 응답에 부적합하다.
// 라우트는 즉시 jobId를 돌려주고, 실제 작업은 백그라운드에서 이 저장소의 상태를 갱신한다.
// 단일 Express 프로세스이므로 모듈 스코프 Map으로 충분하다(프로세스 재시작 시 초기화됨).
const jobs = new Map();

export function createJob(id) {
  jobs.set(id, { id, status: 'pending', message: '', createdAt: Date.now() });
}

export function updateJob(id, status, message = '') {
  const job = jobs.get(id);
  if (!job) return;
  job.status = status;
  job.message = message;
}

export function getJob(id) {
  return jobs.get(id);
}
