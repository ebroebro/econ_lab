import { config } from '../config.js';
import { buildBlocks } from './naverBlocks.js';

const TOOL_TIMEOUT_MS = 5 * 60 * 1000; // 로그인/CAPTCHA/에디터 로딩까지 넉넉히.

// 실제 stdio 연결: naver-blog-mcp를 `uv run naver-blog-mcp`로 띄운다. 이 프로젝트는
// 절대 수정하지 않고 spawn만 한다. 테스트에서는 deps.connect로 목을 주입한다.
async function defaultConnect(mcpDir) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({
    command: 'uv',
    args: ['run', 'naver-blog-mcp'],
    cwd: mcpDir,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const client = new Client({ name: 'econ-content-pipeline', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

function extractText(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return '';
  return content.find((c) => c?.type === 'text' && typeof c.text === 'string')?.text ?? '';
}

function parseToolResult(text) {
  try {
    const j = JSON.parse(text);
    return { success: Boolean(j.success), message: String(j.message ?? ''), postUrl: j.post_url ?? null };
  } catch {
    return { success: false, message: text || '알 수 없는 오류', postUrl: null };
  }
}

export async function postToNaverBlog({ title, body, imagePaths = [], tags = [] }, deps = {}) {
  const mcpDir = deps.mcpDir ?? config.naverBlogMcpDir;
  if (!mcpDir) {
    return { success: false, message: 'NAVER_BLOG_MCP_DIR 환경변수가 설정되지 않았습니다.', postUrl: null };
  }
  const connect = deps.connect || (() => defaultConnect(mcpDir));
  const blocks = buildBlocks(body, imagePaths);

  let client;
  try {
    client = await connect();
    const result = await client.callTool(
      { name: 'naver_blog_create_post', arguments: { title, blocks, tags, publish: false } },
      undefined,
      { timeout: TOOL_TIMEOUT_MS },
    );
    return parseToolResult(extractText(result));
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : '알 수 없는 오류', postUrl: null };
  } finally {
    if (client) await client.close().catch(() => {});
  }
}
