// Viruagent(https://github.com/greekr4/Viruagent)의 src/lib/tistory.js를 그대로 require해
// 로그인 세션 쿠키로 티스토리 비공식 내부 API를 호출한다. 이 프로젝트는 절대 수정하지 않는다.
import { createRequire } from 'node:module';
import { config } from '../config.js';
import { buildBlocks } from './naverBlocks.js';
import { renderBlocksToHtml } from './tistoryBlocks.js';

function loadDefaultLib(viruagentDir) {
  const require = createRequire(import.meta.url);
  return require(`${viruagentDir}/src/lib/tistory.js`);
}

export async function postToTistory({ title, body, imagePaths = [], tags = [] }, deps = {}) {
  const viruagentDir = deps.viruagentDir ?? config.tistoryViruagentDir;
  if (!viruagentDir) {
    return { success: false, message: 'TISTORY_VIRUAGENT_DIR 환경변수가 설정되지 않았습니다.', postUrl: null };
  }
  void tags; // Viruagent의 saveDraft는 태그를 지원하지 않는다(사용자가 티스토리 에디터에서 직접 지정).

  try {
    const lib = deps.lib || loadDefaultLib(viruagentDir);
    await lib.initBlog();
    const blocks = buildBlocks(body, imagePaths);
    const { html, warnings } = await renderBlocksToHtml(blocks, { uploadImage: lib.uploadImage });
    const result = await lib.saveDraft({ title, content: html });
    const sequence = result?.draft?.sequence;
    const base = `임시저장 완료(sequence: ${sequence})`;
    const message = warnings.length ? `${base}. 경고: ${warnings.join('; ')}` : base;
    return { success: true, message, postUrl: null };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : '알 수 없는 오류', postUrl: null };
  }
}
