import { config } from '../src/config.js';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
const candidates = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
  'nano-banana-pro-preview',
  'gemini-3-pro-image-preview',
];

for (const model of candidates) {
  try {
    const res = await ai.models.generateContent({
      model,
      contents: 'A simple abstract dark blue gradient background, no text.',
    });
    const hasImage = (res.candidates?.[0]?.content?.parts || []).some(p => p.inlineData?.data);
    console.log(`${model}: ${hasImage ? '✅ 이미지 생성됨' : '⚠️ 응답은 왔지만 이미지 없음'}`);
    if (hasImage) break;
  } catch (e) {
    const msg = e.message || String(e);
    const quota = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
    console.log(`${model}: ❌ ${quota ? '무료 등급 할당량 없음(429)' : msg.slice(0, 120)}`);
  }
}
