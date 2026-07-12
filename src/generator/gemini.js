import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

let client = null;
function getClient() {
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다 (.env)');
  if (!client) client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  return client;
}

export async function generateText(prompt) {
  const res = await getClient().models.generateContent({
    model: config.geminiTextModel,
    contents: prompt,
  });
  return res.text;
}

export async function generateImage(prompt) {
  try {
    const res = await getClient().models.generateContent({
      model: config.geminiImageModel,
      contents: prompt,
    });
    for (const part of res.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.data) return Buffer.from(part.inlineData.data, 'base64');
    }
    return null;
  } catch (e) {
    console.error('[gemini:image] 실패:', e.message);
    return null;
  }
}
