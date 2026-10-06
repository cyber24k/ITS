/**
 * ITS - Admin Routes
 * User management, role changes, reports
 */

const express = require('express');
const xss     = require('xss');
const { getDb } = require('../db/database');
const { asyncHandler } = require('../utils');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// All routes require auth + admin
router.use(requireAuth, requireAdmin);

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
router.get('/users', asyncHandler(async (req, res) => {
  const db = getDb();
  const search = req.query.search ? `%${req.query.search}%` : null;

  let sql = `
    SELECT id, user_id, full_name, email, department, role, status, avatar_color, created_at
    FROM users
  `;
  const params = [];

  if (search) {
    sql += ' WHERE full_name LIKE ? OR email LIKE ? OR user_id LIKE ?';
    params.push(search, search, search);
  }

  sql += ' ORDER BY created_at DESC LIMIT 100';

  const users = await db.prepare(sql).all(...params);
  return res.json({ users });
}));

// ─── PATCH /api/admin/users/:id/role ─────────────────────────────────────────
router.patch('/users/:id/role', asyncHandler(async (req, res) => {
  const validRoles = ['user', 'technician', 'admin'];
  const newRole = xss(String(req.body.role || '').trim());

  if (!validRoles.includes(newRole)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }

  const db   = getDb();
  const user = await db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // Prevent demoting yourself
  if (parseInt(req.params.id) === req.user.id && newRole !== 'admin') {
    return res.status(400).json({ error: 'You cannot change your own admin role.' });
  }

  await db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(newRole, req.params.id);

  return res.json({ message: `Role updated to ${newRole}.` });
}));

// ─── PATCH /api/admin/users/:id/status ───────────────────────────────────────
router.patch('/users/:id/status', asyncHandler(async (req, res) => {
  const validStatuses = ['active', 'suspended'];
  const newStatus = xss(String(req.body.status || '').trim());

  if (!validStatuses.includes(newStatus)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }

  const db   = getDb();
  const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'You cannot change your own account status.' });
  }

  await db.prepare('UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(newStatus, req.params.id);

  return res.json({ message: `User status updated to ${newStatus}.` });
}));

// ─── GET /api/admin/reports ───────────────────────────────────────────────────
router.get('/reports', asyncHandler(async (req, res) => {
  const db = getDb();

  const [
    ticketsOverTime, byStatus, byCategory, byPriority, resolutionByPriority,
    satisfaction, avgSatisfaction, topTechs, slaStats
  ] = await Promise.all([
    db.prepare(`
      SELECT DATE(created_at) AS day, COUNT(*) AS count
      FROM tickets
      WHERE created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY)
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `).all(),
    db.prepare('SELECT status, COUNT(*) AS count FROM tickets GROUP BY status').all(),
    db.prepare('SELECT category, COUNT(*) AS count FROM tickets GROUP BY category').all(),
    db.prepare('SELECT priority, COUNT(*) AS count FROM tickets GROUP BY priority').all(),
    db.prepare(`
      SELECT priority,
             AVG(TIMESTAMPDIFF(SECOND, created_at, resolved_at) / 3600) AS avg_hours,
             COUNT(*) AS count
      FROM tickets WHERE resolved_at IS NOT NULL
      GROUP BY priority
    `).all(),
    db.prepare('SELECT stars, COUNT(*) AS count FROM ratings GROUP BY stars ORDER BY stars').all(),
    db.prepare('SELECT AVG(stars) AS avg, COUNT(*) AS total FROM ratings').get(),
    db.prepare(`
    SELECT u.full_name, u.user_id, COUNT(*) as resolved, AVG(r.stars) as avg_rating
    FROM tickets t
    JOIN users u ON u.id = t.assignee_id
    LEFT JOIN ratings r ON r.ticket_id = t.id
    WHERE t.status IN ('Resolved', 'Closed') AND t.assignee_id IS NOT NULL
    GROUP BY u.id, u.full_name, u.user_id
    ORDER BY resolved DESC LIMIT 10
    `).all(),
    db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN sla_deadline < COALESCE(resolved_at, CURRENT_TIMESTAMP)
                      THEN 1 ELSE 0 END) AS breached
      FROM tickets
    `).get()
  ]);

  return res.json({
    ticketsOverTime, byStatus, byCategory, byPriority,
    resolutionByPriority, satisfaction, avgSatisfaction,
    topTechs, slaStats
  });
}));

// ─── GET /api/admin/technicians ───────────────────────────────────────────────
router.get('/technicians', asyncHandler(async (req, res) => {
  const db = getDb();
  const techs = await db.prepare(`
    SELECT id, user_id, full_name, department, avatar_color,
           (SELECT COUNT(*) FROM tickets WHERE assignee_id = users.id AND status = 'In Progress') as open_tickets
    FROM users
    WHERE role IN ('technician', 'admin') AND status = 'active'
    ORDER BY full_name
  `).all();
  return res.json({ technicians: techs });
}));

module.exports = router;
