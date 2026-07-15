import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// 테스트가 운영 데이터 폴더에 실제 파일을 쓰지 않도록 DATA_DIR로 격리 가능하게 함.
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const imagesDir = path.join(dataDir, 'images');
fs.mkdirSync(imagesDir, { recursive: true });

export const config = {
  port: Number(process.env.PORT || 3000),
  root,
  dataDir,
  imagesDir,
  brandName: process.env.BRAND_NAME || 'ECON LAB',
  instagramHandle: process.env.INSTAGRAM_HANDLE || '@econ_lab_kr',
  naverBlogMcpDir: process.env.NAVER_BLOG_MCP_DIR || '',
  tistoryViruagentDir: process.env.TISTORY_VIRUAGENT_DIR || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiTextModel: process.env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash',
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image',
  ecosApiKey: process.env.ECOS_API_KEY || '',
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  meta: {
    igUserId: process.env.IG_USER_ID || '',
    igAccessToken: process.env.IG_ACCESS_TOKEN || '',
    threadsUserId: process.env.THREADS_USER_ID || '',
    threadsAccessToken: process.env.THREADS_ACCESS_TOKEN || '',
  },
};
