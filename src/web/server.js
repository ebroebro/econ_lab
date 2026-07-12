import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { generateDraftContent } from '../generator/content.js';
import { generateBackgrounds } from '../renderer/background.js';
import { renderCards } from '../renderer/render.js';
import { runAllCollectors } from '../collectors/agent.js';
import { uploadImages as defaultUploadImages } from '../publisher/hosting.js';
import { publishToInstagram as defaultPublishInstagram } from '../publisher/instagram.js';
import { publishToThreads as defaultPublishThreads } from '../publisher/threads.js';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

export function createServer(db, deps = {}) {
  const generateContent = deps.generateContent || generateDraftContent;
  const makeBackgrounds = deps.generateBackgrounds || generateBackgrounds;
  const renderCardImages = deps.renderCards || renderCards;
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
    const { sourceIds } = req.body;
    if (!Array.isArray(sourceIds) || !sourceIds.length) return res.status(400).json({ error: 'sourceIds 필요' });
    try {
      const sources = sourceIds.map(id => db.getSource(id)).filter(Boolean);
      if (!sources.length) return res.status(400).json({ error: '소스를 찾을 수 없습니다' });
      const content = await generateContent(sources);
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
      const content = await generateContent(sources);
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
      const bgs = await makeBackgrounds(d.content.cards);
      const paths = await renderCardImages(d.id, d.content.cards, bgs);
      db.deleteCards(d.id);
      paths.forEach((p, i) => db.saveCard({ draftId: d.id, seq: i + 1, template: d.content.cards[i].template, imagePath: p }));
      db.updateDraftStatus(d.id, 'images_ready');
      res.json({ cards: db.listCards(d.id) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/drafts/:id/cards', (req, res) => res.json(db.listCards(Number(req.params.id))));

  app.post('/api/drafts/:id/publish', async (req, res) => {
    const d = db.getDraft(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'not found' });
    const cards = db.listCards(d.id);
    if (d.status !== 'images_ready' || !cards.length) {
      return res.status(400).json({ error: '이미지 생성이 완료되지 않았습니다' });
    }
    const result = { instagram: null, threads: null };
    let urls;
    try {
      urls = await uploadImages(cards.map(c => c.image_path));
    } catch (e) {
      return res.status(500).json({ error: `이미지 업로드 실패: ${e.message}` });
    }
    try { result.instagram = await publishInstagram({ imageUrls: urls, caption: d.content.caption }); }
    catch (e) { result.instagram = { error: e.message }; }
    try { result.threads = await publishThreads({ text: d.content.threadsText, imageUrl: urls[0] }); }
    catch (e) { result.threads = { error: e.message }; }

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
