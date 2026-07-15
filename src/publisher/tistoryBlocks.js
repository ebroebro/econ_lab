// naverBlocks.buildBlocks가 만든 블록(text/image/divider/quote)을 티스토리 임시저장용 HTML로
// 렌더링한다. 이미지 블록만 실제 업로드(IO)가 필요하고 나머지는 순수 문자열 변환이다.
import fs from 'node:fs';
import path from 'node:path';

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function textToHtml(text) {
  return `<p>${escapeHtml(text).split('\n').join('<br>')}</p>`;
}

async function imageToHtml(block, uploadImage, warnings) {
  const filename = path.basename(block.path);
  try {
    const buffer = fs.readFileSync(block.path);
    const uploaded = await uploadImage(buffer, filename);
    const dnaMatch = uploaded?.url?.match(/\/dna\/(.+)/);
    if (!dnaMatch) throw new Error('업로드 응답에 dna 경로가 없습니다');
    const kagePath = `kage@${dnaMatch[1]}`;
    const html = `<p>[##_Image|${kagePath}|CDM|1.3|{"originWidth":0,"originHeight":0,"style":"alignCenter"}_##]</p>`;
    return { html, kagePath };
  } catch (e) {
    warnings.push(`이미지 업로드 실패(${filename}): ${e.message}`);
    return null;
  }
}

export async function renderBlocksToHtml(blocks, { uploadImage }) {
  const parts = [];
  const warnings = [];
  let thumbnailKage = null;

  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push(textToHtml(block.text));
    } else if (block.type === 'divider') {
      parts.push('<hr>');
    } else if (block.type === 'quote') {
      parts.push(`<blockquote><p>${escapeHtml(block.text)}</p></blockquote>`);
    } else if (block.type === 'image') {
      const result = await imageToHtml(block, uploadImage, warnings);
      if (result) {
        parts.push(result.html);
        if (!thumbnailKage) thumbnailKage = result.kagePath;
      }
    }
  }

  return { html: parts.join('\n'), thumbnailKage, warnings };
}
