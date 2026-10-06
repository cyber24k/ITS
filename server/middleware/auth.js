/**
 * ITS - Authentication Middleware
 * Verifies JWT from httpOnly cookie, attaches req.user.
 */

const jwt = require('jsonwebtoken');
const { getDb } = require('../db/database');

// Verify JWT and attach user to request
async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.its_token;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (_) {
    res.clearCookie('its_token');
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const user = await getDb().prepare(
      'SELECT id, user_id, full_name, email, department, role, status, avatar_color FROM users WHERE id = ?'
    ).get(payload.id);

    if (!user || user.status !== 'active') {
      res.clearCookie('its_token');
      return res.status(401).json({ error: 'Account inactive or not found' });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Require technician or admin role
function requireTech(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.role !== 'technician' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Technician or Admin access required' });
  }
  next();
}

// Require admin role
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Optional auth — attaches req.user if token present, continues regardless
async function optionalAuth(req, res, next) {
  const token = req.cookies && req.cookies.its_token;
  if (token) {
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_) {
      return next();
    }

    try {
      const user = await getDb().prepare(
        'SELECT id, user_id, full_name, email, department, role, status, avatar_color FROM users WHERE id = ?'
      ).get(payload.id);
      if (user && user.status === 'active') req.user = user;
    } catch (err) {
      return next(err);
    }
  }
  next();
}

module.exports = { requireAuth, requireTech, requireAdmin, optionalAuth };
