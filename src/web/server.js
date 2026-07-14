import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { generateDraftContent, generateStoryDraft } from '../generator/content.js';
import { renderCards } from '../renderer/render.js';
import { generateCardImage } from '../renderer/aiCard.js';
import { runAllCollectors } from '../collectors/agent.js';
import { uploadImages as defaultUploadImages } from '../publisher/hosting.js';
import { publishToInstagram as defaultPublishInstagram } from '../publisher/instagram.js';
import { publishToThreads as defaultPublishThreads } from '../publisher/threads.js';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

export function createServer(db, deps = {}) {
  const generateContent = deps.generateContent || generateDraftContent;
  const generateStory = deps.generateStoryDraft || generateStoryDraft;
  const renderCardImages = deps.renderCards || renderCards;
  const makeCardImage = deps.generateCardImage || generateCardImage;
  const uploadImages = deps.uploadImages || defaultUploadImages;
  const publishInstagram = deps.publishInstagram || defaultPublishInstagram;
  const publishThreads = deps.publishThreads || defaultPublishThreads;

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(pub));
  app.use('/images', express.static(config.imagesDir));

  app.get('/api/sources', (req, res) =>
    res.json(db.listSources({ status: req.query.status || null, type: req.query.type || null, limit: 200 })));

  app.post('/api/sources', (req, res) => {
    const { title, summary = '' } = req.body;
    if (!title) return res.status(400).json({ error: 'title 필요' });
    const id = db.insertSource({ type: 'manual', title, url: null, summary, data: null });
    res.json({ id });
  });

  app.post('/api/sources/:id/archive', (req, res) => {
    db.updateSourceStatus(Number(req.params.id), 'archived');
    res.json({ ok: true });
  });

  app.post('/api/collect', async (_req, res) => {
    try { res.json(await runAllCollectors(db)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/drafts', async (req, res) => {
    const { sourceIds, cardTypes, storyMode } = req.body;
    if (!Array.isArray(sourceIds) || !sourceIds.length) return res.status(400).json({ error: 'sourceIds 필요' });
    try {
      const sources = sourceIds.map(id => db.getSource(id)).filter(Boolean);
      if (!sources.length) return res.status(400).json({ error: '소스를 찾을 수 없습니다' });
      let content;
      if (storyMode) {
        content = await generateStory(sources);
        content.storyMode = true;
      } else {
        const types = Array.isArray(cardTypes) && cardTypes.length ? cardTypes : null;
        content = await generateContent(sources, types);
      }
      const draftId = db.createDraft(sourceIds);
      db.updateDraftContent(draftId, content);
      sourceIds.forEach(id => db.updateSourceStatus(id, 'used'));
      res.json(db.getDraft(draftId));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/drafts', (_req, res) => res.json(db.listDrafts()));

  app.get('/api/drafts/:id', (req, res) => {
    const d = db.getDraft(Number(req.params.id));
    return d ? res.json(d) : res.status(404).json({ error: 'not found' });
  });

  app.put('/api/drafts/:id/content', (req, res) => {
    const d = db.getDraft(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'not found' });
    if (!req.body.content) return res.status(400).json({ error: 'content 필요' });
    db.updateDraftContent(d.id, req.body.content);
    res.json(db.getDraft(d.id));
  });

  app.post('/api/drafts/:id/regenerate', async (req, res) => {
    const d = db.getDraft(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'not found' });
    try {
      const sources = d.source_ids.map(id => db.getSource(id)).filter(Boolean);
      let content;
      if (d.content?.storyMode) {
        content = await generateStory(sources);
        content.storyMode = true;
      } else {
        const cardTypes = d.content?.cards?.length ? d.content.cards.map(c => c.template) : null;
        content = await generateContent(sources, cardTypes);
      }
      db.updateDraftContent(d.id, content);
      db.updateDraftStatus(d.id, 'draft');
      res.json(db.getDraft(d.id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/drafts/:id/approve-text', (req, res) => {
    const d = db.getDraft(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'not found' });
    db.updateDraftStatus(d.id, 'text_approved');
    res.json(db.getDraft(d.id));
  });

  app.post('/api/drafts/:id/images', async (req, res) => {
    const d = db.getDraft(Number(req.params.id));
    if (!d?.content?.cards?.length) return res.status(400).json({ error: '카드 문구가 없습니다' });
    try {
      const cards = d.content.cards;
      const dir = path.join(config.imagesDir, String(d.id));
      fs.mkdirSync(dir, { recursive: true });
      const paths = new Array(cards.length);
      const fallbackIndices = [];

      // 카드마다 Gemini 이미지 생성을 먼저 시도하고, 실패한 카드만 기존 HTML 렌더로 대체한다.
      for (let i = 0; i < cards.length; i++) {
        const buf = await makeCardImage(cards[i], { brand: config.brandName });
        if (buf) {
          const file = path.join(dir, `card-${i + 1}.png`);
          fs.writeFileSync(file, buf);
          paths[i] = file;
        } else {
          fallbackIndices.push(i);
        }
      }

      if (fallbackIndices.length) {
        const fallbackPaths = await renderCardImages(d.id, cards, { only: fallbackIndices });
        fallbackIndices.forEach((i) => { paths[i] = fallbackPaths[i]; });
      }

      db.deleteCards(d.id);
      paths.forEach((p, i) => db.saveCard({ draftId: d.id, seq: i + 1, template: cards[i].template, imagePath: p }));
      db.updateDraftStatus(d.id, 'images_ready');
      res.json({ cards: db.listCards(d.id), aiGenerated: cards.length - fallbackIndices.length, fallback: fallbackIndices.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/drafts/:id/cards', (req, res) => res.json(db.listCards(Number(req.params.id))));

  app.post('/api/drafts/:id/publish', async (req, res) => {
    const d = db.getDraft(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'not found' });
    const cards = db.listCards(d.id);
    if (!cards.length) {
      return res.status(400).json({ error: '이미지 생성이 완료되지 않았습니다' });
    }
    // 이전 배포 시도에서 이미 성공한 플랫폼은 재발행(중복 게시)하지 않고 건너뛴다.
    const priorPosts = db.listPosts().filter((p) => p.draft_id === d.id);
    const alreadyInstagram = priorPosts.find((p) => p.instagram_url)?.instagram_url || null;
    const alreadyThreads = priorPosts.find((p) => p.threads_url)?.threads_url || null;

    const result = {
      instagram: alreadyInstagram ? { permalink: alreadyInstagram, skipped: true } : null,
      threads: alreadyThreads ? { permalink: alreadyThreads, skipped: true } : null,
    };
    let urls;
    try {
      urls = await uploadImages(cards.map(c => c.image_path));
    } catch (e) {
      return res.status(500).json({ error: `이미지 업로드 실패: ${e.message}` });
    }
    if (!alreadyInstagram) {
      try { result.instagram = await publishInstagram({ imageUrls: urls, caption: d.content.caption }); }
      catch (e) { result.instagram = { error: e.message }; }
    }
    if (!alreadyThreads) {
      try { result.threads = await publishThreads({ text: d.content.threadsText, imageUrl: urls[0] }); }
      catch (e) { result.threads = { error: e.message }; }
    }

    const anyOk = result.instagram?.permalink || result.threads?.permalink;
    db.savePost({
      draftId: d.id,
      instagramUrl: result.instagram?.permalink || null,
      threadsUrl: result.threads?.permalink || null,
      error: (result.instagram?.error || result.threads?.error) ? result : null,
    });
    if (anyOk) db.updateDraftStatus(d.id, 'published');
    return anyOk ? res.json(result) : res.status(500).json(result);
  });

  app.get('/api/posts', (_req, res) => res.json(db.listPosts()));

  return app;
}
