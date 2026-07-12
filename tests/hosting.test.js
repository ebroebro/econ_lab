import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadImages } from '../src/publisher/hosting.js';

test('Cloudinary 키 없으면 안내 오류', async () => {
  const emptyCreds = { cloudName: '', apiKey: '', apiSecret: '' };
  await assert.rejects(() => uploadImages(['x.png'], emptyCreds), /CLOUDINARY/);
});
