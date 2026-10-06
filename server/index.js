/**
 * ITS - IT Support Ticketing System
 * Main Express Server Entry Point
 */

require('dotenv').config();

const express      = require('express');
const cookieParser = require('cookie-parser');
const path         = require('path');
const rateLimit    = require('express-rate-limit');

const { initDb }  = require('./db/database');
const { initEmail } = require('./email/mailer');

// ─── Route Imports ────────────────────────────────────────────────────────────
const authRoutes   = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');
const adminRoutes  = require('./routes/admin');
const kbRoutes     = require('./routes/kb');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());

// Serve static files from /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// General API rate limiter
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  skip: () => process.env.NODE_ENV !== 'production',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' }
}));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/admin',   adminRoutes);
app.use('/api/kb',      kbRoutes);

app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'reset-password.html'));
});

// Friendly URL redirects for emails and direct navigation
app.get('/tickets/:id', (req, res) => res.redirect(`/ticket-detail.html?id=${req.params.id}`));
app.get('/login',      (req, res) => res.redirect('/login.html'));
app.get('/register',   (req, res) => res.redirect('/register.html'));
app.get('/dashboard',  (req, res) => res.redirect('/dashboard.html'));
app.get('/tickets',    (req, res) => res.redirect('/tickets.html'));
app.get('/queue',      (req, res) => res.redirect('/queue.html'));
app.get('/new-ticket', (req, res) => res.redirect('/new-ticket.html'));
app.get('/kb',         (req, res) => res.redirect('/kb.html'));
app.get('/admin',      (req, res) => res.redirect('/admin.html'));
app.get('/profile',    (req, res) => res.redirect('/profile.html'));


// ─── Catch-all: serve index.html for SPA routes ───────────────────────────────
app.get('*', (req, res) => {
  // Don't catch API or file routes
  if (req.path.startsWith('/api/') || req.path.includes('.')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function start() {
  try {
    await initDb(); // connect to MySQL, initialize schema, and seed initial data
    initEmail();   // verify SMTP or use console fallback
    app.listen(PORT, () => {
      console.log(`\nITS Server running at http://localhost:${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('   Admin account credentials are configured locally and are not written to the log.\n');
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
