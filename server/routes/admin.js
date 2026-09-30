/**
 * ITS - Admin Routes
 * User management, role changes, reports
 */

const express = require('express');
const xss     = require('xss');
const { getDb } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// All routes require auth + admin
router.use(requireAuth, requireAdmin);

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
router.get('/users', (req, res) => {
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

  const users = db.prepare(sql).all(...params);
  return res.json({ users });
});

// ─── PATCH /api/admin/users/:id/role ─────────────────────────────────────────
router.patch('/users/:id/role', (req, res) => {
  const validRoles = ['user', 'technician', 'admin'];
  const newRole = xss(String(req.body.role || '').trim());

  if (!validRoles.includes(newRole)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }

  const db   = getDb();
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // Prevent demoting yourself
  if (parseInt(req.params.id) === req.user.id && newRole !== 'admin') {
    return res.status(400).json({ error: 'You cannot change your own admin role.' });
  }

  db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(newRole, req.params.id);

  return res.json({ message: `Role updated to ${newRole}.` });
});

// ─── PATCH /api/admin/users/:id/status ───────────────────────────────────────
router.patch('/users/:id/status', (req, res) => {
  const validStatuses = ['active', 'suspended', 'unconfirmed'];
  const newStatus = xss(String(req.body.status || '').trim());

  if (!validStatuses.includes(newStatus)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }

  const db   = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'You cannot change your own account status.' });
  }

  db.prepare('UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(newStatus, req.params.id);

  return res.json({ message: `User status updated to ${newStatus}.` });
});

// ─── GET /api/admin/reports ───────────────────────────────────────────────────
router.get('/reports', (req, res) => {
  const db = getDb();

  // Tickets over time (last 30 days by day)
  const ticketsOverTime = db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as count
    FROM tickets
    WHERE created_at >= date('now', '-30 days')
    GROUP BY day
    ORDER BY day ASC
  `).all();

  // Tickets by status
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as count FROM tickets GROUP BY status
  `).all();

  // Tickets by category
  const byCategory = db.prepare(`
    SELECT category, COUNT(*) as count FROM tickets GROUP BY category
  `).all();

  // Tickets by priority
  const byPriority = db.prepare(`
    SELECT priority, COUNT(*) as count FROM tickets GROUP BY priority
  `).all();

  // Average resolution time by priority
  const resolutionByPriority = db.prepare(`
    SELECT priority,
           AVG((julianday(resolved_at) - julianday(created_at)) * 24) as avg_hours,
           COUNT(*) as count
    FROM tickets WHERE resolved_at IS NOT NULL
    GROUP BY priority
  `).all();

  // Satisfaction scores
  const satisfaction = db.prepare(`
    SELECT stars, COUNT(*) as count FROM ratings GROUP BY stars ORDER BY stars
  `).all();

  const avgSatisfaction = db.prepare(`
    SELECT AVG(stars) as avg, COUNT(*) as total FROM ratings
  `).get();

  // Top technicians by resolved tickets
  const topTechs = db.prepare(`
    SELECT u.full_name, u.user_id, COUNT(*) as resolved, AVG(r.stars) as avg_rating
    FROM tickets t
    JOIN users u ON u.id = t.assignee_id
    LEFT JOIN ratings r ON r.ticket_id = t.id
    WHERE t.status IN ('Resolved', 'Closed') AND t.assignee_id IS NOT NULL
    GROUP BY t.assignee_id
    ORDER BY resolved DESC LIMIT 10
  `).all();

  // SLA breach rate
  const slaStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN sla_deadline < COALESCE(resolved_at, datetime('now'))
               THEN 1 ELSE 0 END) as breached
    FROM tickets
  `).get();

  return res.json({
    ticketsOverTime, byStatus, byCategory, byPriority,
    resolutionByPriority, satisfaction, avgSatisfaction,
    topTechs, slaStats
  });
});

// ─── GET /api/admin/technicians ───────────────────────────────────────────────
router.get('/technicians', (req, res) => {
  const db = getDb();
  const techs = db.prepare(`
    SELECT id, user_id, full_name, department, avatar_color,
           (SELECT COUNT(*) FROM tickets WHERE assignee_id = users.id AND status = 'In Progress') as open_tickets
    FROM users
    WHERE role IN ('technician', 'admin') AND status = 'active'
    ORDER BY full_name
  `).all();
  return res.json({ technicians: techs });
});

module.exports = router;
