import { config } from '../src/config.js';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
const pager = await ai.models.list();
for await (const m of pager) {
  const name = m.name?.replace('models/', '') || '';
  if (/flash|image|pro/i.test(name)) console.log(name);
}
