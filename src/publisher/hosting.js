import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config.js';

export async function uploadImages(paths) {
  const { cloudName, apiKey, apiSecret } = config.cloudinary;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET을 .env에 설정하세요');
  }
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
  const urls = [];
  for (const p of paths) {
    const r = await cloudinary.uploader.upload(p, { folder: 'econ-cards' });
    urls.push(r.secure_url);
  }
  return urls;
}
