/**
 * ITS - Database Setup (SQLite via better-sqlite3)
 * Creates all tables and seeds the first admin account on first run.
 */

const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');
const { generateUserId, generateTicketId } = require('../utils');

const DB_PATH = path.join(__dirname, '..', 'its.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');  // Better performance
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDb() {
  const database = getDb();

  // ─── Users ────────────────────────────────────────────────────────────────
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT    UNIQUE NOT NULL,         -- ITS-XXXXXX
      full_name     TEXT    NOT NULL,
      email         TEXT    UNIQUE NOT NULL,
      department    TEXT    NOT NULL DEFAULT '',
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'user', -- user | technician | admin
      status        TEXT    NOT NULL DEFAULT 'unconfirmed', -- unconfirmed | active | suspended
      avatar_color  TEXT    NOT NULL DEFAULT '#6366f1',
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ─── Email Tokens (confirmation + password reset + forgot-id) ─────────────
  database.exec(`
    CREATE TABLE IF NOT EXISTS email_tokens (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token       TEXT    UNIQUE NOT NULL,
      type        TEXT    NOT NULL, -- confirm | reset | forgot_id
      expires_at  DATETIME NOT NULL,
      used        INTEGER  NOT NULL DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ─── Tickets ──────────────────────────────────────────────────────────────
  database.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id     TEXT    UNIQUE NOT NULL,         -- TKT-000123
      title         TEXT    NOT NULL,
      description   TEXT    NOT NULL,
      category      TEXT    NOT NULL,               -- Hardware|Software|Network|Account/Access|Other
      priority      TEXT    NOT NULL DEFAULT 'Medium', -- Low|Medium|High|Critical
      status        TEXT    NOT NULL DEFAULT 'New', -- New|In Progress|Waiting on User|Resolved|Closed
      submitter_id  INTEGER NOT NULL REFERENCES users(id),
      assignee_id   INTEGER REFERENCES users(id),
      attachment    TEXT,                           -- file path relative to /uploads
      sla_deadline  DATETIME,
      resolved_at   DATETIME,
      closed_at     DATETIME,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ─── Ticket Comments ──────────────────────────────────────────────────────
  database.exec(`
    CREATE TABLE IF NOT EXISTS ticket_comments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      author_id   INTEGER NOT NULL REFERENCES users(id),
      body        TEXT    NOT NULL,
      is_internal INTEGER NOT NULL DEFAULT 0,  -- 1 = technician-only note
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ─── Ticket History (audit trail) ─────────────────────────────────────────
  database.exec(`
    CREATE TABLE IF NOT EXISTS ticket_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      actor_id    INTEGER REFERENCES users(id),
      action      TEXT    NOT NULL,   -- e.g. "Status changed to In Progress"
      old_value   TEXT,
      new_value   TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ─── Ratings ──────────────────────────────────────────────────────────────
  database.exec(`
    CREATE TABLE IF NOT EXISTS ratings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id   INTEGER UNIQUE NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      stars       INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
      comment     TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ─── Knowledge Base Articles ───────────────────────────────────────────────
  database.exec(`
    CREATE TABLE IF NOT EXISTS kb_articles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      body        TEXT    NOT NULL,
      category    TEXT    NOT NULL DEFAULT 'General',
      author_id   INTEGER NOT NULL REFERENCES users(id),
      published   INTEGER NOT NULL DEFAULT 1,
      views       INTEGER NOT NULL DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ─── Seed initial admin, technician & KB articles ─────────────────────────
  seedInitialData(database);

  console.log('✅ Database initialized successfully.');
  return database;
}

function seedInitialData(database) {
  // 1. Seed Admin
  const adminExists = database.prepare("SELECT id, user_id FROM users WHERE role = 'admin' LIMIT 1").get();
  let adminId;

  if (!adminExists) {
    const adminEmail    = process.env.ADMIN_EMAIL    || 'admin@its.local';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin1234';
    const adminName     = process.env.ADMIN_NAME     || 'System Administrator';

    const hash   = bcrypt.hashSync(adminPassword, 12);
    const userId = generateUserId(database);

    const res = database.prepare(`
      INSERT INTO users (user_id, full_name, email, department, password_hash, role, status, avatar_color)
      VALUES (?, ?, ?, ?, ?, 'admin', 'active', '#f59e0b')
    `).run(userId, adminName, adminEmail, 'IT Administration', hash);

    adminId = res.lastInsertRowid;
    console.log(`✅ Admin account seeded: ${userId} (${adminEmail}) / ${adminPassword}`);
  } else {
    adminId = adminExists.id;
  }

  // 2. Seed Demo Technician
  const techExists = database.prepare("SELECT id FROM users WHERE role = 'technician' LIMIT 1").get();
  if (!techExists) {
    const techEmail    = 'tech@its.local';
    const techPassword = 'Tech1234';
    const techHash     = bcrypt.hashSync(techPassword, 12);
    const techUserId   = generateUserId(database);

    database.prepare(`
      INSERT INTO users (user_id, full_name, email, department, password_hash, role, status, avatar_color)
      VALUES (?, 'Alex Rivera', ?, 'Tier 2 Support', ?, 'technician', 'active', '#3b82f6')
    `).run(techUserId, techEmail, techHash);

    console.log(`✅ Demo Technician seeded: ${techUserId} (${techEmail}) / ${techPassword}`);
  }

  // 3. Seed Knowledge Base Articles
  const kbCount = database.prepare('SELECT COUNT(*) as c FROM kb_articles').get().c;
  if (kbCount === 0) {
    const articles = [
      {
        title: 'How to Connect to Corporate VPN from Home',
        category: 'Network',
        body: `Follow these steps to connect securely to the internal corporate network:

1. Download and install the GlobalProtect or WireGuard client from the company portal.
2. Launch the client and enter the portal address: vpn.company.local
3. When prompted, authenticate using your ITS User ID (e.g. ITS-XXXXXX) and your password.
4. Verify multi-factor authentication (MFA) push on your mobile device.
5. Once connected, your status will turn green and you can access internal databases, file servers, and intranet sites.

Troubleshooting tips:
• If the connection drops or fails with error 10054, disable any personal 3rd-party VPN software or restart your home Wi-Fi router.
• Ensure DNS settings are set to automatic DHCP.`
      },
      {
        title: 'Password Policy & Resetting Forgotten Credentials',
        category: 'Account/Access',
        body: `Password Security Guidelines:

• Passwords must be at least 8 characters long and contain both letters and digits.
• Do not reuse old passwords or share passwords with colleagues.
• IT Support staff will NEVER ask for your password under any circumstances.

If you forgot your password:
1. Navigate to the login page and click "Forgot password?".
2. Enter your ITS User ID or registered corporate email.
3. Follow the secure link emailed to you (valid for 2 hours) to choose a new password.

If you forgot your User ID:
• Click "Forgot User ID" on the login page and enter your email address to receive your ITS-XXXXXX identifier immediately.`
      },
      {
        title: 'Office Wi-Fi Setup (Corporate & Guest Networks)',
        category: 'Network',
        body: `Connecting to wireless in all office locations:

Corporate Network ("ITS-Secure"):
1. Select "ITS-Secure" from your list of available networks.
2. Under EAP method, select "PEAP".
3. Under Phase 2 authentication, select "MSCHAPv2".
4. Enter your ITS User ID and network password.
5. Accept the server security certificate.

Visitor Network ("ITS-Guest"):
• Select "ITS-Guest" and open your browser to the captive portal.
• Enter your name and host email for temporary 24-hour internet-only access.`
      },
      {
        title: 'Configuring Work Email on Mobile (iOS & Android)',
        category: 'Email',
        body: `To access your corporate mailbox and calendar on your smartphone:

Apple iOS:
1. Open Settings → Mail → Accounts → Add Account.
2. Select Microsoft Exchange / Corporate IMAP.
3. Enter your full work email address and password.
4. Enable Mail, Contacts, and Calendars synchronization.

Android:
1. Open the Outlook or Gmail app.
2. Tap Add Account → Exchange / Office 365.
3. Enter your work email and complete modern authentication.
4. Accept the corporate security device policy when prompted.`
      },
      {
        title: 'Requesting New Hardware, Peripherals, or Monitor Replacement',
        category: 'Hardware',
        body: `Standard Equipment Policy:

• Standard workstation setup includes a laptop, dual 27-inch monitors, docking station, keyboard, and ergonomic mouse.
• If your equipment is defective, submit an ITS ticket under "Hardware" with priority "Medium" (or "High" if your machine cannot boot).
• Include the asset tag number (located on the silver barcode sticker on the bottom of the device).
• Defective peripherals (cables, mice, power adapters) can be swapped at the IT Helpdesk on the 3rd floor during walk-in hours (9:00 AM - 5:00 PM).`
      }
    ];

    const insertKb = database.prepare(`
      INSERT INTO kb_articles (title, body, category, author_id, published)
      VALUES (?, ?, ?, ?, 1)
    `);

    articles.forEach(art => {
      insertKb.run(art.title, art.body, art.category, adminId);
    });

    console.log(`✅ Seeded ${articles.length} starter Knowledge Base articles.`);
  }
}

module.exports = { initDb, getDb };
