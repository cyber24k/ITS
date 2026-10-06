/**
 * ITS - MySQL/MariaDB database setup and legacy SQLite migration.
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const { generateUserId } = require('../utils');

const LEGACY_DB_PATH = path.join(__dirname, '..', 'its.db');
const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(16) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    department VARCHAR(255) NOT NULL DEFAULT '',
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'user',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    avatar_color VARCHAR(16) NOT NULL DEFAULT '#6366f1',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS email_tokens (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    token VARCHAR(128) NOT NULL UNIQUE,
    type VARCHAR(32) NOT NULL,
    expires_at DATETIME NOT NULL,
    used TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email_tokens_user_type (user_id, type, used),
    CONSTRAINT fk_email_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS tickets (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ticket_id VARCHAR(24) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    description LONGTEXT NOT NULL,
    category VARCHAR(64) NOT NULL,
    priority VARCHAR(24) NOT NULL DEFAULT 'Medium',
    status VARCHAR(32) NOT NULL DEFAULT 'New',
    submitter_id INT UNSIGNED NOT NULL,
    assignee_id INT UNSIGNED NULL,
    attachment VARCHAR(1024) NULL,
    sla_deadline DATETIME NULL,
    resolved_at DATETIME NULL,
    closed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tickets_submitter (submitter_id),
    INDEX idx_tickets_assignee (assignee_id),
    INDEX idx_tickets_status_priority (status, priority),
    CONSTRAINT fk_tickets_submitter FOREIGN KEY (submitter_id) REFERENCES users(id),
    CONSTRAINT fk_tickets_assignee FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ticket_comments (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT UNSIGNED NOT NULL,
    author_id INT UNSIGNED NOT NULL,
    body LONGTEXT NOT NULL,
    is_internal TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ticket_comments_ticket (ticket_id, created_at),
    CONSTRAINT fk_ticket_comments_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    CONSTRAINT fk_ticket_comments_author FOREIGN KEY (author_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ticket_history (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT UNSIGNED NOT NULL,
    actor_id INT UNSIGNED NULL,
    action VARCHAR(255) NOT NULL,
    old_value LONGTEXT NULL,
    new_value LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ticket_history_ticket (ticket_id, created_at),
    CONSTRAINT fk_ticket_history_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    CONSTRAINT fk_ticket_history_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ratings (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT UNSIGNED NOT NULL UNIQUE,
    user_id INT UNSIGNED NOT NULL,
    stars TINYINT UNSIGNED NOT NULL,
    comment LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_ratings_stars CHECK (stars BETWEEN 1 AND 5),
    CONSTRAINT fk_ratings_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    CONSTRAINT fk_ratings_user FOREIGN KEY (user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS kb_articles (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    body LONGTEXT NOT NULL,
    category VARCHAR(64) NOT NULL DEFAULT 'General',
    author_id INT UNSIGNED NOT NULL,
    published TINYINT(1) NOT NULL DEFAULT 1,
    views INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_kb_articles_published (published, updated_at),
    CONSTRAINT fk_kb_articles_author FOREIGN KEY (author_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS app_migrations (
    migration_key VARCHAR(100) NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

let pool;
let database;

function createDatabaseAdapter(connectionPool) {
  return {
    prepare(sql) {
      return {
        async all(...values) {
          const [rows] = await connectionPool.execute(sql, values);
          return rows;
        },
        async get(...values) {
          const [rows] = await connectionPool.execute(sql, values);
          return rows[0];
        },
        async run(...values) {
          const [result] = await connectionPool.execute(sql, values);
          return {
            lastInsertRowid: Number(result.insertId),
            changes: result.affectedRows
          };
        }
      };
    }
  };
}

function getDb() {
  if (!database) {
    throw new Error('Database is not initialized. Call initDb() before handling requests.');
  }
  return database;
}

async function closeDb() {
  const currentPool = pool;
  pool = undefined;
  database = undefined;
  if (currentPool) await currentPool.end();
}

async function migrateLegacySqlite(connection) {
  if (!fs.existsSync(LEGACY_DB_PATH)) return;

  const [migrationRows] = await connection.execute(
    'SELECT migration_key FROM app_migrations WHERE migration_key = ?',
    ['sqlite-to-mysql-v1']
  );
  if (migrationRows.length) return;

  const { DatabaseSync } = require('node:sqlite');
  const legacy = new DatabaseSync(LEGACY_DB_PATH, { readOnly: true });
  try {
    const tables = new Set(legacy.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).all().map(row => row.name));
    if (!tables.has('users')) return;

    const [counts] = await connection.execute(
      'SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM tickets) AS tickets, (SELECT COUNT(*) FROM kb_articles) AS articles'
    );
    if (Number(counts[0].users) || Number(counts[0].tickets) || Number(counts[0].articles)) {
      console.warn('Legacy SQLite import skipped because the MySQL database already contains app data.');
      return;
    }

    const importTables = [
      'users', 'email_tokens', 'tickets', 'ticket_comments',
      'ticket_history', 'ratings', 'kb_articles'
    ];
    const rowsByTable = new Map();
    for (const table of importTables) {
      if (tables.has(table)) {
        rowsByTable.set(table, legacy.prepare(`SELECT * FROM \`${table}\``).all());
      }
    }

    await connection.beginTransaction();
    try {
      for (const table of importTables) {
        const rows = rowsByTable.get(table) || [];
        for (const row of rows) {
          const columns = Object.keys(row);
          const columnSql = columns.map(column => `\`${column}\``).join(', ');
          const placeholders = columns.map(() => '?').join(', ');
          const values = columns.map(column => {
            const value = row[column];
            if (typeof value === 'string' && /_at$/.test(column) && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
              return value.slice(0, 19).replace('T', ' ');
            }
            return value;
          });
          await connection.execute(
            `INSERT INTO \`${table}\` (${columnSql}) VALUES (${placeholders})`,
            values
          );
        }
      }
      await connection.execute(
        'INSERT INTO app_migrations (migration_key) VALUES (?)',
        ['sqlite-to-mysql-v1']
      );
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    }

    const rowCount = [...rowsByTable.values()].reduce((total, rows) => total + rows.length, 0);
    console.log(`Imported ${rowCount} legacy application records from SQLite to MySQL.`);
  } finally {
    legacy.close();
  }
}

async function initDb() {
  if (database) return database;

  pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number.parseInt(process.env.MYSQL_PORT || '3306', 10),
    database: process.env.MYSQL_DATABASE || 'itsupport',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // Keep each connection's UTC session setting after it returns to the pool.
    resetOnRelease: false,
    timezone: 'Z',
    dateStrings: true
  });
  pool.on('connection', connection => {
    connection.query("SET time_zone = '+00:00'", err => {
      if (err) {
        console.error('Failed to set MySQL session time zone to UTC:', err);
        connection.destroy();
      }
    });
  });
  database = createDatabaseAdapter(pool);

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.ping();
    for (const statement of TABLES) {
      await connection.query(statement);
    }
    await migrateLegacySqlite(connection);
    await connection.query(
      "UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE status = 'unconfirmed'"
    );
    await connection.query(
      "UPDATE email_tokens SET used = 1 WHERE type = 'confirm' AND used = 0"
    );
    await seedInitialData(database);
    console.log('Database initialized successfully (MySQL/MariaDB).');
    return database;
  } catch (err) {
    database = undefined;
    if (connection) {
      connection.release();
      connection = undefined;
    }
    await pool.end();
    pool = undefined;
    throw err;
  } finally {
    if (connection) connection.release();
  }
}

async function seedInitialData(db) {
  let admin = await db.prepare(
    "SELECT id, user_id FROM users WHERE role = 'admin' LIMIT 1"
  ).get();
  let adminId;

  if (!admin) {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@its.local';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin1234';
    const adminName = process.env.ADMIN_NAME || 'System Administrator';
    const hash = await bcrypt.hash(adminPassword, 12);
    const userId = await generateUserId(db);

    const result = await db.prepare(`
      INSERT INTO users (user_id, full_name, email, department, password_hash, role, status, avatar_color)
      VALUES (?, ?, ?, ?, ?, 'admin', 'active', '#f59e0b')
    `).run(userId, adminName, adminEmail, 'IT Administration', hash);

    adminId = result.lastInsertRowid;
    console.log(`Admin account seeded: ${userId} (${adminEmail}).`);
  } else {
    adminId = admin.id;
  }

  const technician = await db.prepare(
    "SELECT id FROM users WHERE role = 'technician' LIMIT 1"
  ).get();
  if (!technician) {
    const techHash = await bcrypt.hash('Tech1234', 12);
    const techUserId = await generateUserId(db);
    await db.prepare(`
      INSERT INTO users (user_id, full_name, email, department, password_hash, role, status, avatar_color)
      VALUES (?, 'Alex Rivera', 'tech@its.local', 'Tier 2 Support', ?, 'technician', 'active', '#3b82f6')
    `).run(techUserId, techHash);
    console.log(`Demo technician seeded: ${techUserId} (tech@its.local).`);
  }

  const kbCount = await db.prepare('SELECT COUNT(*) AS c FROM kb_articles').get();
  if (Number(kbCount.c) === 0) {
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

    for (const article of articles) {
      await db.prepare(`
        INSERT INTO kb_articles (title, body, category, author_id, published)
        VALUES (?, ?, ?, ?, 1)
      `).run(article.title, article.body, article.category, adminId);
    }
    console.log(`Seeded ${articles.length} starter Knowledge Base articles.`);
  }
}

module.exports = { initDb, getDb, closeDb };
