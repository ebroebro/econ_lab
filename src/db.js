import Database from 'better-sqlite3';
import path from 'node:path';
import { config } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  summary TEXT,
  data TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  collected_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_url ON sources(url) WHERE url IS NOT NULL;
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_ids TEXT NOT NULL,
  content TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL REFERENCES drafts(id),
  seq INTEGER NOT NULL,
  template TEXT NOT NULL,
  image_path TEXT,
  bg_image_path TEXT
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL REFERENCES drafts(id),
  instagram_url TEXT,
  threads_url TEXT,
  error TEXT,
  published_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);`;

function rowWithData(row) {
  return { ...row, data: row.data ? JSON.parse(row.data) : null };
}

export function openDb(filePath) {
  const raw = new Database(filePath);
  raw.pragma('journal_mode = WAL');
  raw.exec(SCHEMA);
  return {
    raw,
    insertSource({ type, title, url = null, summary = '', data = null }) {
      if (url) {
        const dup = raw.prepare('SELECT id FROM sources WHERE url=?').get(url);
        if (dup) return dup.id;
      }
      const r = raw.prepare(
        'INSERT INTO sources (type,title,url,summary,data) VALUES (?,?,?,?,?)'
      ).run(type, title, url, summary, data ? JSON.stringify(data) : null);
      return Number(r.lastInsertRowid);
    },
    getSource(id) {
      const row = raw.prepare('SELECT * FROM sources WHERE id=?').get(id);
      return row ? rowWithData(row) : null;
    },
    listSources({ status = null, type = null, limit = 100 } = {}) {
      let sql = 'SELECT * FROM sources WHERE 1=1';
      const args = [];
      if (status) { sql += ' AND status=?'; args.push(status); }
      if (type) { sql += ' AND type=?'; args.push(type); }
      sql += ' ORDER BY collected_at DESC, id DESC LIMIT ?'; args.push(limit);
      return raw.prepare(sql).all(...args).map(rowWithData);
    },
    updateSourceStatus(id, status) {
      raw.prepare('UPDATE sources SET status=? WHERE id=?').run(status, id);
    },
    createDraft(sourceIds) {
      const r = raw.prepare('INSERT INTO drafts (source_ids) VALUES (?)')
        .run(JSON.stringify(sourceIds));
      return Number(r.lastInsertRowid);
    },
    getDraft(id) {
      const d = raw.prepare('SELECT * FROM drafts WHERE id=?').get(id);
      if (!d) return null;
      return { ...d, source_ids: JSON.parse(d.source_ids), content: d.content ? JSON.parse(d.content) : null };
    },
    listDrafts() {
      return raw.prepare('SELECT id, status, created_at, updated_at, content FROM drafts ORDER BY id DESC').all()
        .map(d => ({ ...d, content: d.content ? JSON.parse(d.content) : null }));
    },
    updateDraftContent(id, content) {
      raw.prepare("UPDATE drafts SET content=?, updated_at=datetime('now','localtime') WHERE id=?")
        .run(JSON.stringify(content), id);
    },
    updateDraftStatus(id, status) {
      raw.prepare("UPDATE drafts SET status=?, updated_at=datetime('now','localtime') WHERE id=?").run(status, id);
    },
    saveCard({ draftId, seq, template, imagePath = null, bgImagePath = null }) {
      const r = raw.prepare('INSERT INTO cards (draft_id,seq,template,image_path,bg_image_path) VALUES (?,?,?,?,?)')
        .run(draftId, seq, template, imagePath, bgImagePath);
      return Number(r.lastInsertRowid);
    },
    listCards(draftId) {
      return raw.prepare('SELECT * FROM cards WHERE draft_id=? ORDER BY seq').all(draftId);
    },
    deleteCards(draftId) {
      raw.prepare('DELETE FROM cards WHERE draft_id=?').run(draftId);
    },
    savePost({ draftId, instagramUrl = null, threadsUrl = null, error = null }) {
      const r = raw.prepare('INSERT INTO posts (draft_id,instagram_url,threads_url,error) VALUES (?,?,?,?)')
        .run(draftId, instagramUrl, threadsUrl, error ? JSON.stringify(error) : null);
      return Number(r.lastInsertRowid);
    },
    listPosts() {
      return raw.prepare('SELECT * FROM posts ORDER BY id DESC').all();
    },
  };
}

export const db = openDb(path.join(config.dataDir, 'db.sqlite'));
