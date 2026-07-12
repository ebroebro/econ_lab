import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const imagesDir = path.join(dataDir, 'images');
fs.mkdirSync(imagesDir, { recursive: true });

export const config = {
  port: Number(process.env.PORT || 3000),
  root,
  dataDir,
  imagesDir,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiTextModel: process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash',
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
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
