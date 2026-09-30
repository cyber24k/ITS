/**
 * ITS - Shared Utility Functions
 */

const crypto = require('crypto');

// ─── Generate unique ITS-XXXXXX User ID ───────────────────────────────────────
function generateUserId(db) {
  let userId;
  let exists = true;
  while (exists) {
    const digits = Math.floor(100000 + Math.random() * 900000).toString();
    userId = `ITS-${digits}`;
    const row = db.prepare('SELECT id FROM users WHERE user_id = ?').get(userId);
    exists = !!row;
  }
  return userId;
}

// ─── Generate unique TKT-000123 Ticket ID ─────────────────────────────────────
function generateTicketId(db) {
  const count = db.prepare('SELECT COUNT(*) as c FROM tickets').get().c;
  const num = String(count + 1).padStart(6, '0');
  return `TKT-${num}`;
}

// ─── Generate a secure random token ──────────────────────────────────────────
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── Calculate SLA deadline based on priority ─────────────────────────────────
// Critical=1h, High=4h, Medium=8h, Low=24h
function getSlaDeadline(priority) {
  const hours = { Critical: 1, High: 4, Medium: 8, Low: 24 };
  const h = hours[priority] || 8;
  const deadline = new Date();
  deadline.setHours(deadline.getHours() + h);
  return deadline.toISOString();
}

// ─── Avatar initials color palette ────────────────────────────────────────────
const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f59e0b', '#10b981', '#3b82f6', '#14b8a6'
];
function randomAvatarColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

// ─── Get user initials ────────────────────────────────────────────────────────
function getInitials(name) {
  if (!name) return '??';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ─── Format token expiry date ─────────────────────────────────────────────────
function tokenExpiresAt(hours) {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

module.exports = {
  generateUserId,
  generateTicketId,
  generateToken,
  getSlaDeadline,
  randomAvatarColor,
  getInitials,
  tokenExpiresAt
};
