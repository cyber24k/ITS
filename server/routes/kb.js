/**
 * ITS - Knowledge Base Routes
 * CRUD for KB articles; all authenticated users can read, tech/admin can write
 */

const express = require('express');
const xss     = require('xss');
const { getDb } = require('../db/database');
const { asyncHandler } = require('../utils');
const { requireAuth, requireTech } = require('../middleware/auth');

const router = express.Router();

// ─── GET /api/kb ──────────────────────────────────────────────────────────────
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const db     = getDb();
  const search = req.query.search;
  const cat    = req.query.category;

  let sql = `
    SELECT a.id, a.title, a.category, a.views, a.published, a.created_at, a.updated_at,
           u.full_name AS author_name, u.user_id AS author_user_id
    FROM kb_articles a JOIN users u ON u.id = a.author_id
  `;
  const conditions = ['a.published = 1'];
  const params = [];

  // Admins and techs can see unpublished
  if (req.user.role === 'admin' || req.user.role === 'technician') {
    conditions.length = 0; // no filter on published
  }

  if (search) {
    conditions.push('(a.title LIKE ? OR a.body LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (cat) {
    conditions.push('a.category = ?');
    params.push(cat);
  }

  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY a.views DESC, a.updated_at DESC LIMIT 50';

  const articles = await db.prepare(sql).all(...params);
  return res.json({ articles });
}));

// ─── GET /api/kb/search (lightweight, for ticket form suggestions) ────────────
router.get('/search', requireAuth, asyncHandler(async (req, res) => {
  const q = req.query.q;
  if (!q || q.length < 2) return res.json({ articles: [] });

  const db = getDb();
  const articles = await db.prepare(`
    SELECT id, title, category FROM kb_articles
    WHERE published = 1 AND (title LIKE ? OR body LIKE ?)
    LIMIT 5
  `).all(`%${q}%`, `%${q}%`);

  return res.json({ articles });
}));

// ─── GET /api/kb/:id ──────────────────────────────────────────────────────────
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const db = getDb();
  const article = await db.prepare(`
    SELECT a.*, u.full_name AS author_name, u.user_id AS author_user_id
    FROM kb_articles a JOIN users u ON u.id = a.author_id
    WHERE a.id = ?
  `).get(req.params.id);

  if (!article) return res.status(404).json({ error: 'Article not found.' });
  if (!article.published && req.user.role === 'user') {
    return res.status(403).json({ error: 'Article not available.' });
  }

  // Increment view count
  await db.prepare('UPDATE kb_articles SET views = views + 1 WHERE id = ?').run(article.id);

  return res.json({ article });
}));

// ─── POST /api/kb ─────────────────────────────────────────────────────────────
router.post('/', requireAuth, requireTech, asyncHandler(async (req, res) => {
  try {
    const title     = xss(String(req.body.title    || '').trim());
    const body      = xss(String(req.body.body     || '').trim());
    const category  = xss(String(req.body.category || 'General').trim());
    const published = req.body.published !== false && req.body.published !== 'false' ? 1 : 0;

    if (!title || title.length < 5)  return res.status(400).json({ error: 'Title must be at least 5 characters.' });
    if (!body  || body.length < 20)  return res.status(400).json({ error: 'Body must be at least 20 characters.' });

    const db = getDb();
    const result = await db.prepare(`
      INSERT INTO kb_articles (title, body, category, author_id, published)
      VALUES (?, ?, ?, ?, ?)
    `).run(title, body, category, req.user.id, published);

    const article = await db.prepare('SELECT * FROM kb_articles WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({ article, message: 'Article created.' });
  } catch (err) {
    console.error('Create KB article error:', err);
    return res.status(500).json({ error: 'Failed to create article.' });
  }
}));

// ─── PUT /api/kb/:id ──────────────────────────────────────────────────────────
router.put('/:id', requireAuth, requireTech, asyncHandler(async (req, res) => {
  try {
    const db      = getDb();
    const article = await db.prepare('SELECT * FROM kb_articles WHERE id = ?').get(req.params.id);
    if (!article) return res.status(404).json({ error: 'Article not found.' });

    const title     = xss(String(req.body.title    || article.title).trim());
    const body      = xss(String(req.body.body     || article.body).trim());
    const category  = xss(String(req.body.category || article.category).trim());
    const published = req.body.published !== undefined
      ? (req.body.published ? 1 : 0)
      : article.published;

    await db.prepare(`
      UPDATE kb_articles SET title = ?, body = ?, category = ?, published = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(title, body, category, published, article.id);

    const updated = await db.prepare('SELECT * FROM kb_articles WHERE id = ?').get(article.id);
    return res.json({ article: updated, message: 'Article updated.' });
  } catch (err) {
    console.error('Update KB article error:', err);
    return res.status(500).json({ error: 'Failed to update article.' });
  }
}));

// ─── DELETE /api/kb/:id ───────────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireTech, asyncHandler(async (req, res) => {
  const db      = getDb();
  const article = await db.prepare('SELECT id FROM kb_articles WHERE id = ?').get(req.params.id);
  if (!article) return res.status(404).json({ error: 'Article not found.' });

  await db.prepare('DELETE FROM kb_articles WHERE id = ?').run(article.id);
  return res.json({ message: 'Article deleted.' });
}));

module.exports = router;
