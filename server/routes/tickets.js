/**
 * ITS - Ticket Routes
 * Create, read, update, comment, assign, rate tickets.
 */

const express  = require('express');
const xss      = require('xss');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

const { getDb } = require('../db/database');
const { generateTicketId, getSlaDeadline } = require('../utils');
const { requireAuth, requireTech } = require('../middleware/auth');
const {
  sendTicketCreatedEmail,
  sendTicketUpdatedEmail,
  sendTicketResolvedEmail
} = require('../email/mailer');

const router = express.Router();
const APP_URL = () => process.env.APP_URL || 'http://localhost:3000';

// ─── File Upload (attachments) ────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + Math.round(Math.random() * 1e6);
    const ext  = path.extname(file.originalname).toLowerCase();
    cb(null, safe + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },  // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.txt', '.log'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('File type not allowed'));
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const VALID_CATEGORIES = ['Hardware', 'Software', 'Network', 'Account/Access', 'Other'];
const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const VALID_STATUSES   = ['New', 'In Progress', 'Waiting on User', 'Resolved', 'Closed'];

function logHistory(db, ticketId, actorId, action, oldVal = null, newVal = null) {
  db.prepare(`
    INSERT INTO ticket_history (ticket_id, actor_id, action, old_value, new_value)
    VALUES (?, ?, ?, ?, ?)
  `).run(ticketId, actorId, action, oldVal, newVal);
}

// Build filter/sort query dynamically
function buildTicketQuery(base, params, filters, user) {
  const conditions = [...(base ? [base] : [])];
  const values     = [];

  if (filters.status)   { conditions.push('t.status = ?');   values.push(filters.status); }
  if (filters.priority) { conditions.push('t.priority = ?'); values.push(filters.priority); }
  if (filters.category) { conditions.push('t.category = ?'); values.push(filters.category); }
  if (filters.assignee) {
    if (filters.assignee === 'unassigned') conditions.push('t.assignee_id IS NULL');
    else { conditions.push('t.assignee_id = ?'); values.push(parseInt(filters.assignee)); }
  }
  if (filters.search) {
    conditions.push('(t.title LIKE ? OR t.ticket_id LIKE ? OR t.description LIKE ?)');
    const s = `%${filters.search}%`;
    values.push(s, s, s);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const sortMap = {
    newest:   't.created_at DESC',
    oldest:   't.created_at ASC',
    priority: "CASE t.priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END",
    updated:  't.updated_at DESC',
    sla:      't.sla_deadline ASC'
  };
  const order = sortMap[filters.sort] || 't.created_at DESC';

  const limit  = Math.min(parseInt(filters.limit  || '50'),  100);
  const offset = parseInt(filters.offset || '0');

  return {
    sql: `
      SELECT t.*,
        sub.full_name AS submitter_name, sub.user_id AS submitter_user_id, sub.avatar_color AS submitter_color,
        ass.full_name AS assignee_name,  ass.user_id AS assignee_user_id,  ass.avatar_color AS assignee_color,
        r.stars AS rating_stars
      FROM tickets t
      JOIN users sub ON sub.id = t.submitter_id
      LEFT JOIN users ass ON ass.id = t.assignee_id
      LEFT JOIN ratings r ON r.ticket_id = t.id
      ${where}
      ORDER BY ${order}
      LIMIT ? OFFSET ?
    `,
    values: [...params, ...values, limit, offset]
  };
}

// ─── GET /api/tickets ─────────────────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db   = getDb();
  const user = req.user;

  let base, params;
  if (user.role === 'user') {
    base   = 't.submitter_id = ?';
    params = [user.id];
  } else {
    base   = null;
    params = [];
  }

  const { sql, values } = buildTicketQuery(base, params, req.query, user);

  try {
    const tickets = db.prepare(sql).all(...values);
    // Count total (without pagination)
    const countSql = sql.replace(/SELECT t\.\*[\s\S]+?FROM tickets t/, 'SELECT COUNT(*) as total FROM tickets t')
                        .replace(/ORDER BY[\s\S]+$/, '');
    const countVals = values.slice(0, -2);

    let total = tickets.length;
    try { total = db.prepare(countSql).get(...countVals).total; } catch (_) {}

    return res.json({ tickets, total });
  } catch (err) {
    console.error('Get tickets error:', err);
    return res.status(500).json({ error: 'Failed to fetch tickets.' });
  }
});

// ─── POST /api/tickets ────────────────────────────────────────────────────────
router.post('/', requireAuth, upload.single('attachment'), async (req, res) => {
  try {
    const title       = xss(String(req.body.title       || '').trim());
    const description = xss(String(req.body.description || '').trim());
    const category    = xss(String(req.body.category    || '').trim());
    const priority    = xss(String(req.body.priority    || 'Medium').trim());

    const errors = [];
    if (!title || title.length < 5)          errors.push('Title must be at least 5 characters.');
    if (!description || description.length < 10) errors.push('Description must be at least 10 characters.');
    if (!VALID_CATEGORIES.includes(category)) errors.push('Invalid category.');
    if (!VALID_PRIORITIES.includes(priority)) errors.push('Invalid priority.');

    if (errors.length) {
      if (req.file) fs.unlinkSync(req.file.path);  // cleanup upload
      return res.status(400).json({ error: errors.join(' ') });
    }

    const db       = getDb();
    const ticketId = generateTicketId(db);
    const sla      = getSlaDeadline(priority);
    const attach   = req.file ? `/uploads/${req.file.filename}` : null;

    const result = db.prepare(`
      INSERT INTO tickets (ticket_id, title, description, category, priority, status, submitter_id, attachment, sla_deadline)
      VALUES (?, ?, ?, ?, ?, 'New', ?, ?, ?)
    `).run(ticketId, title, description, category, priority, req.user.id, attach, sla);

    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(result.lastInsertRowid);

    logHistory(db, result.lastInsertRowid, req.user.id, 'Ticket created', null, `${ticketId} — ${title}`);

    // Email notification
    try {
      await sendTicketCreatedEmail(req.user, ticket, APP_URL());
    } catch (emailErr) {
      console.warn('Email send failed:', emailErr.message);
    }

    return res.status(201).json({ ticket, message: 'Ticket created successfully.' });
  } catch (err) {
    console.error('Create ticket error:', err);
    return res.status(500).json({ error: 'Failed to create ticket.' });
  }
});

// ─── GET /api/tickets/meta/technicians ─────────────────────────────────────────
router.get('/meta/technicians', requireAuth, requireTech, (req, res) => {
  const db = getDb();
  const techs = db.prepare(`
    SELECT id, user_id, full_name, department, avatar_color
    FROM users
    WHERE role IN ('technician', 'admin') AND status = 'active'
    ORDER BY full_name
  `).all();
  return res.json({ technicians: techs });
});

// ─── GET /api/tickets/:id ─────────────────────────────────────────────────────
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const ticket = db.prepare(`
    SELECT t.*,
      sub.full_name AS submitter_name, sub.user_id AS submitter_user_id,
      sub.email AS submitter_email, sub.avatar_color AS submitter_color,
      ass.full_name AS assignee_name, ass.user_id AS assignee_user_id, ass.avatar_color AS assignee_color,
      r.stars AS rating_stars, r.comment AS rating_comment
    FROM tickets t
    JOIN users sub ON sub.id = t.submitter_id
    LEFT JOIN users ass ON ass.id = t.assignee_id
    LEFT JOIN ratings r ON r.ticket_id = t.id
    WHERE t.ticket_id = ?
  `).get(req.params.id);

  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

  // Users can only see their own tickets
  if (req.user.role === 'user' && ticket.submitter_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied.' });
  }

  // Comments — users don't see internal notes
  const commentSql = req.user.role === 'user'
    ? `SELECT tc.*, u.full_name AS author_name, u.user_id AS author_user_id, u.avatar_color AS author_color, u.role AS author_role
       FROM ticket_comments tc JOIN users u ON u.id = tc.author_id
       WHERE tc.ticket_id = ? AND tc.is_internal = 0 ORDER BY tc.created_at ASC`
    : `SELECT tc.*, u.full_name AS author_name, u.user_id AS author_user_id, u.avatar_color AS author_color, u.role AS author_role
       FROM ticket_comments tc JOIN users u ON u.id = tc.author_id
       WHERE tc.ticket_id = ? ORDER BY tc.created_at ASC`;

  const comments = db.prepare(commentSql).all(ticket.id);

  const history = db.prepare(`
    SELECT th.*, u.full_name AS actor_name
    FROM ticket_history th
    LEFT JOIN users u ON u.id = th.actor_id
    WHERE th.ticket_id = ?
    ORDER BY th.created_at ASC
  `).all(ticket.id);

  return res.json({ ticket, comments, history });
});

// ─── PATCH /api/tickets/:id ───────────────────────────────────────────────────
router.patch('/:id', requireAuth, requireTech, (req, res) => {
  try {
    const db     = getDb();
    const ticket = db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    const updates     = [];
    const values      = [];
    const historyLogs = [];

    // Status change
    if (req.body.status && VALID_STATUSES.includes(req.body.status)) {
      if (req.body.status !== ticket.status) {
        updates.push('status = ?');
        values.push(req.body.status);
        historyLogs.push({ action: 'Status changed', old: ticket.status, new: req.body.status });

        if (req.body.status === 'Resolved') {
          updates.push('resolved_at = CURRENT_TIMESTAMP');
        }
        if (req.body.status === 'Closed') {
          updates.push('closed_at = CURRENT_TIMESTAMP');
        }
      }
    }

    // Priority change
    if (req.body.priority && VALID_PRIORITIES.includes(req.body.priority)) {
      if (req.body.priority !== ticket.priority) {
        updates.push('priority = ?', 'sla_deadline = ?');
        values.push(req.body.priority, getSlaDeadline(req.body.priority));
        historyLogs.push({ action: 'Priority changed', old: ticket.priority, new: req.body.priority });
      }
    }

    // Assignment
    if ('assignee_id' in req.body) {
      const newAssignee = req.body.assignee_id ? parseInt(req.body.assignee_id) : null;
      if (newAssignee !== ticket.assignee_id) {
        updates.push('assignee_id = ?');
        values.push(newAssignee);

        if (newAssignee) {
          const aUser = db.prepare('SELECT full_name FROM users WHERE id = ?').get(newAssignee);
          historyLogs.push({ action: 'Assigned to', old: null, new: aUser ? aUser.full_name : 'Unknown' });
        } else {
          historyLogs.push({ action: 'Unassigned', old: null, new: null });
        }

        // Auto-set In Progress when assigned (if not explicitly changing status)
        if (newAssignee && ticket.status === 'New' && !req.body.status) {
          updates.push('status = ?');
          values.push('In Progress');
          historyLogs.push({ action: 'Status changed', old: 'New', new: 'In Progress' });
        }
      }
    }

    if (!updates.length) return res.json({ message: 'No changes made.' });

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(ticket.id);

    db.prepare(`UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    // Log all changes
    historyLogs.forEach(h => logHistory(db, ticket.id, req.user.id, h.action, h.old, h.new));

    const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket.id);

    // Email on status change (to submitter)
    if (historyLogs.some(h => h.action === 'Status changed')) {
      const submitter = db.prepare('SELECT * FROM users WHERE id = ?').get(ticket.submitter_id);
      const newStatus = req.body.status;
      if (submitter) {
        const updateMsg = `Status changed to: <strong>${newStatus}</strong>`;
        if (newStatus === 'Resolved') {
          sendTicketResolvedEmail(submitter, updated, APP_URL()).catch(console.warn);
        } else {
          sendTicketUpdatedEmail(submitter, updated, updateMsg, APP_URL()).catch(console.warn);
        }
      }
    }

    return res.json({ ticket: updated, message: 'Ticket updated.' });
  } catch (err) {
    console.error('Update ticket error:', err);
    return res.status(500).json({ error: 'Failed to update ticket.' });
  }
});

// ─── POST /api/tickets/:id/comments ──────────────────────────────────────────
router.post('/:id/comments', requireAuth, async (req, res) => {
  try {
    const body       = xss(String(req.body.body       || '').trim());
    const isInternal = req.body.is_internal === true || req.body.is_internal === 'true';

    if (!body || body.length < 2) {
      return res.status(400).json({ error: 'Comment must be at least 2 characters.' });
    }

    // Only technicians/admins can post internal notes
    if (isInternal && req.user.role === 'user') {
      return res.status(403).json({ error: 'Not authorized to post internal notes.' });
    }

    const db     = getDb();
    const ticket = db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    // Users can only comment on their own tickets
    if (req.user.role === 'user' && ticket.submitter_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const result = db.prepare(`
      INSERT INTO ticket_comments (ticket_id, author_id, body, is_internal)
      VALUES (?, ?, ?, ?)
    `).run(ticket.id, req.user.id, body, isInternal ? 1 : 0);

    db.prepare('UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(ticket.id);

    const noteLabel = isInternal ? 'Internal note added' : 'Comment added';
    logHistory(db, ticket.id, req.user.id, noteLabel, null, body.substring(0, 100));

    // Notify submitter of public comments (not their own)
    if (!isInternal && req.user.id !== ticket.submitter_id) {
      const submitter = db.prepare('SELECT * FROM users WHERE id = ?').get(ticket.submitter_id);
      if (submitter) {
        sendTicketUpdatedEmail(
          submitter, ticket,
          `New comment from ${req.user.full_name}: ${body.substring(0, 200)}`,
          APP_URL()
        ).catch(console.warn);
      }
    }

    const comment = db.prepare(`
      SELECT tc.*, u.full_name AS author_name, u.user_id AS author_user_id, u.avatar_color AS author_color, u.role AS author_role
      FROM ticket_comments tc JOIN users u ON u.id = tc.author_id
      WHERE tc.id = ?
    `).get(result.lastInsertRowid);

    return res.status(201).json({ comment, message: 'Comment added.' });
  } catch (err) {
    console.error('Add comment error:', err);
    return res.status(500).json({ error: 'Failed to add comment.' });
  }
});

// ─── POST /api/tickets/:id/rate ───────────────────────────────────────────────
router.post('/:id/rate', requireAuth, (req, res) => {
  try {
    const stars   = parseInt(req.body.stars   || '0');
    const comment = xss(String(req.body.comment || '').trim());

    if (stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }

    const db     = getDb();
    const ticket = db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    if (ticket.submitter_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the ticket submitter can rate it.' });
    }
    if (ticket.status !== 'Resolved' && ticket.status !== 'Closed') {
      return res.status(400).json({ error: 'You can only rate resolved or closed tickets.' });
    }

    const existing = db.prepare('SELECT id FROM ratings WHERE ticket_id = ?').get(ticket.id);
    if (existing) {
      return res.status(400).json({ error: 'You have already rated this ticket.' });
    }

    db.prepare('INSERT INTO ratings (ticket_id, user_id, stars, comment) VALUES (?, ?, ?, ?)')
      .run(ticket.id, req.user.id, stars, comment || null);

    logHistory(db, ticket.id, req.user.id, 'Ticket rated', null, `${stars} star(s)`);

    return res.json({ message: 'Thank you for your rating!' });
  } catch (err) {
    console.error('Rate ticket error:', err);
    return res.status(500).json({ error: 'Failed to submit rating.' });
  }
});

// ─── GET /api/tickets/stats/summary (admin/tech only) ────────────────────────
router.get('/stats/summary', requireAuth, requireTech, (req, res) => {
  const db = getDb();

  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as count FROM tickets GROUP BY status
  `).all();

  const byCategory = db.prepare(`
    SELECT category, COUNT(*) as count FROM tickets GROUP BY category
  `).all();

  const byPriority = db.prepare(`
    SELECT priority, COUNT(*) as count FROM tickets GROUP BY priority
  `).all();

  const avgResolution = db.prepare(`
    SELECT AVG(
      (julianday(resolved_at) - julianday(created_at)) * 24
    ) as avg_hours
    FROM tickets WHERE resolved_at IS NOT NULL
  `).get();

  const avgRating = db.prepare(`
    SELECT AVG(stars) as avg, COUNT(*) as count FROM ratings
  `).get();

  const slaBreached = db.prepare(`
    SELECT COUNT(*) as count FROM tickets
    WHERE sla_deadline < datetime('now')
      AND status NOT IN ('Resolved', 'Closed')
  `).get();

  const recentTickets = db.prepare(`
    SELECT t.ticket_id, t.title, t.status, t.priority, t.created_at,
           u.full_name AS submitter_name
    FROM tickets t JOIN users sub ON sub.id = t.submitter_id
    LEFT JOIN users u ON u.id = t.submitter_id
    ORDER BY t.created_at DESC LIMIT 10
  `).all();

  return res.json({
    byStatus, byCategory, byPriority,
    avgResolutionHours: avgResolution?.avg_hours || 0,
    avgRating: avgRating?.avg || 0,
    ratingCount: avgRating?.count || 0,
    slaBreached: slaBreached?.count || 0,
    recentTickets
  });
});

module.exports = router;
