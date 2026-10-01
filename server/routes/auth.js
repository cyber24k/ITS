/**
 * ITS - Auth Routes
 * Registration, login, logout, email confirmation, password reset, forgot User ID
 */

const express  = require('express');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const xss      = require('xss');
const validator = require('validator');
const rateLimit = require('express-rate-limit');

const { getDb }           = require('../db/database');
const { generateUserId, generateToken, tokenExpiresAt, randomAvatarColor } = require('../utils');
const {
  sendConfirmationEmail,
  sendPasswordResetEmail,
  sendForgotUserIdEmail
} = require('../email/mailer');

const router = express.Router();
const APP_URL = () => process.env.APP_URL || 'http://localhost:3000';

// ─── Rate Limiters ────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV !== 'production';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,
  skip: () => isDev,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 50,
  skip: () => isDev,
  message: { error: 'Too many registration attempts. Please try again in 1 hour.' },
  standardHeaders: true,
  legacyHeaders: false
});

const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  skip: () => isDev,
  message: { error: 'Too many requests. Please try again shortly.' }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function issueToken(res, user) {
  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.TOKEN_EXPIRY || '7d' }
  );
  res.cookie('its_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000  // 7 days
  });
  return token;
}

function validatePassword(pass) {
  // At least 8 chars, must have letters AND numbers
  return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(pass);
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const fullName   = xss(String(req.body.full_name  || '').trim());
    const email      = xss(String(req.body.email       || '').trim().toLowerCase());
    const department = xss(String(req.body.department  || '').trim());
    const password   = String(req.body.password        || '');
    const confirm    = String(req.body.confirm_password || '');

    // ── Validation ─────────────────────────────────────────────────────────
    const errors = [];
    if (!fullName || fullName.length < 2) errors.push('Full name must be at least 2 characters.');
    if (!validator.isEmail(email))        errors.push('Please enter a valid email address.');
    if (!department)                      errors.push('Department is required.');
    if (!validatePassword(password))      errors.push('Password must be at least 8 characters and include both letters and numbers.');
    if (password !== confirm)             errors.push('Passwords do not match.');

    if (errors.length) return res.status(400).json({ error: errors.join(' ') });

    const db = getDb();

    // ── Check duplicate email (don't reveal in public-facing messages) ─────
    const existing = db.prepare('SELECT id, status FROM users WHERE email = ?').get(email);
    if (existing) {
      // Return same success response to avoid email enumeration
      return res.status(200).json({
        message: 'If that email is not already registered, you\'ll receive a confirmation email shortly.'
      });
    }

    // ── Create user ────────────────────────────────────────────────────────
    const hash    = await bcrypt.hash(password, 12);
    const userId  = await generateUserId(db);
    const color   = randomAvatarColor();

    const inserted = db.prepare(`
      INSERT INTO users (user_id, full_name, email, department, password_hash, role, status, avatar_color)
      VALUES (?, ?, ?, ?, ?, 'user', 'unconfirmed', ?)
    `).run(userId, fullName, email, department, hash, color);

    // ── Send confirmation email ────────────────────────────────────────────
    const token     = generateToken();
    const expiresAt = tokenExpiresAt(parseInt(process.env.CONFIRMATION_TOKEN_EXPIRY_HOURS || '24', 10));

    db.prepare(`
      INSERT INTO email_tokens (user_id, token, type, expires_at)
      VALUES (?, ?, 'confirm', ?)
    `).run(inserted.lastInsertRowid, token, expiresAt);

    const user = { user_id: userId, full_name: fullName, email };
    await sendConfirmationEmail(user, token, APP_URL());

    return res.status(201).json({
      message: 'Account created! Please check your email to confirm your account.',
      user_id: userId
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const userId   = xss(String(req.body.user_id  || '').trim().toUpperCase());
    const password = String(req.body.password || '');

    if (!userId || !password) {
      return res.status(400).json({ error: 'User ID and password are required.' });
    }

    const db   = getDb();
    const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);

    // Always run bcrypt to prevent timing attacks
    const dummyHash = '$2b$12$invalidhashfortimingprotection000000000000000000000000';
    const valid = await bcrypt.compare(password, user ? user.password_hash : dummyHash);

    if (!user || !valid) {
      return res.status(401).json({ error: 'Invalid User ID or password.' });
    }

    if (user.status === 'unconfirmed') {
      return res.status(403).json({
        error: 'Your account is not confirmed. Please check your email.',
        code: 'UNCONFIRMED',
        email: user.email  // for resend link
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been suspended. Please contact an administrator.' });
    }

    issueToken(res, user);

    return res.json({
      message: 'Logged in successfully.',
      user: {
        id: user.id,
        user_id: user.user_id,
        full_name: user.full_name,
        email: user.email,
        department: user.department,
        role: user.role,
        avatar_color: user.avatar_color
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('its_token');
  return res.json({ message: 'Logged out successfully.' });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const token = req.cookies && req.cookies.its_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = getDb().prepare(
      'SELECT id, user_id, full_name, email, department, role, status, avatar_color FROM users WHERE id = ?'
    ).get(payload.id);

    if (!user || user.status !== 'active') return res.status(401).json({ error: 'Not authenticated' });
    return res.json({ user });
  } catch (_) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
});

// ─── GET /api/auth/confirm-email ──────────────────────────────────────────────
router.get('/confirm-email', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token is required.' });

  const db  = getDb();
  const row = db.prepare(`
    SELECT et.id AS token_id, et.expires_at, et.user_id AS user_pk,
           u.email, u.full_name, u.user_id AS public_user_id
    FROM email_tokens et
    JOIN users u ON u.id = et.user_id
    WHERE et.token = ? AND et.type = 'confirm' AND et.used = 0
  `).get(token);

  if (!row) return res.status(400).json({ error: 'invalid_token' });

  if (new Date(row.expires_at) < new Date()) {
    return res.status(400).json({ error: 'expired_token', email: row.email });
  }

  // Mark token used and activate user
  db.prepare('UPDATE email_tokens SET used = 1 WHERE id = ?').run(row.token_id);
  db.prepare('UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('active', row.user_pk);

  return res.json({ message: 'Email confirmed! Your account is now active.', user_id: row.public_user_id });
});

// ─── POST /api/auth/resend-confirmation ──────────────────────────────────────
router.post('/resend-confirmation', emailLimiter, async (req, res) => {
  try {
    const email = xss(String(req.body.email || '').trim().toLowerCase());
    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }

    const db   = getDb();
    const user = db.prepare("SELECT * FROM users WHERE email = ? AND status = 'unconfirmed'").get(email);

    // Always return same response to prevent enumeration
    const msg = 'If that email matches an unconfirmed account, a new confirmation link has been sent.';

    if (!user) return res.json({ message: msg });

    // Invalidate old tokens
    db.prepare("UPDATE email_tokens SET used = 1 WHERE user_id = ? AND type = 'confirm'").run(user.id);

    const token     = generateToken();
    const expiresAt = tokenExpiresAt(24);
    db.prepare('INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES (?, ?, ?, ?)')
      .run(user.id, token, 'confirm', expiresAt);

    await sendConfirmationEmail(user, token, APP_URL());
    return res.json({ message: msg });
  } catch (err) {
    console.error('Resend confirmation error:', err);
    return res.status(500).json({ error: 'Failed to resend confirmation. Please try again.' });
  }
});

// ─── POST /api/auth/forgot-user-id ───────────────────────────────────────────
router.post('/forgot-user-id', emailLimiter, async (req, res) => {
  try {
    const email = xss(String(req.body.email || '').trim().toLowerCase());
    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }

    const db   = getDb();
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

    const msg = 'If that email is registered, your User ID has been sent to it.';
    if (!user) return res.json({ message: msg });

    await sendForgotUserIdEmail(user, APP_URL());
    return res.json({ message: msg });
  } catch (err) {
    console.error('Forgot user ID error:', err);
    return res.status(500).json({ error: 'Failed to process request. Please try again.' });
  }
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
router.post('/forgot-password', emailLimiter, async (req, res) => {
  try {
    // Accept either user_id OR email
    const identifier = xss(String(req.body.identifier || '').trim());
    if (!identifier) return res.status(400).json({ error: 'User ID or email is required.' });

    const db   = getDb();
    let user;
    if (validator.isEmail(identifier)) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(identifier.toLowerCase());
    } else {
      user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(identifier.toUpperCase());
    }

    const msg = 'If your details match an account, a password reset link has been sent.';
    if (!user || user.status !== 'active') return res.json({ message: msg });

    // Invalidate old reset tokens
    db.prepare("UPDATE email_tokens SET used = 1 WHERE user_id = ? AND type = 'reset'").run(user.id);

    const token     = generateToken();
    const hours     = parseInt(process.env.RESET_TOKEN_EXPIRY_HOURS || '2', 10);
    const expiresAt = tokenExpiresAt(hours);

    db.prepare('INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES (?, ?, ?, ?)')
      .run(user.id, token, 'reset', expiresAt);

    await sendPasswordResetEmail(user, token, APP_URL());
    return res.json({ message: msg });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: 'Failed to process request. Please try again.' });
  }
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password, confirm_password } = req.body;
    if (!token)    return res.status(400).json({ error: 'Token is required.' });
    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters with letters and numbers.' });
    }
    if (password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    const db  = getDb();
    const row = db.prepare(`
      SELECT et.*, u.id as uid
      FROM email_tokens et JOIN users u ON u.id = et.user_id
      WHERE et.token = ? AND et.type = 'reset' AND et.used = 0
    `).get(token);

    if (!row) return res.status(400).json({ error: 'Invalid or already used reset link.' });
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    }

    const hash = await bcrypt.hash(password, 12);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, row.uid);
    db.prepare('UPDATE email_tokens SET used = 1 WHERE id = ?').run(row.id);

    return res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'Failed to reset password. Please try again.' });
  }
});

// ─── GET /api/auth/verify-reset-token ────────────────────────────────────────
router.get('/verify-reset-token', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ valid: false });

  const db  = getDb();
  const row = db.prepare(`
    SELECT * FROM email_tokens WHERE token = ? AND type = 'reset' AND used = 0
  `).get(token);

  if (!row || new Date(row.expires_at) < new Date()) {
    return res.json({ valid: false });
  }
  return res.json({ valid: true });
});

// ─── POST /api/auth/change-password ─────────────────────────────────────────
router.post('/change-password', async (req, res) => {
  const token = req.cookies && req.cookies.its_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'Not authenticated' });

    const { current_password, new_password, confirm_password } = req.body;

    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({ error: 'All password fields are required.' });
    }

    const matches = await bcrypt.compare(current_password, user.password_hash);
    if (!matches) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    if (!validatePassword(new_password)) {
      return res.status(400).json({ error: 'New password must be at least 8 characters with letters and numbers.' });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({ error: 'New passwords do not match.' });
    }

    const newHash = await bcrypt.hash(new_password, 12);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(newHash, user.id);

    return res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Failed to update password.' });
  }
});

module.exports = router;
