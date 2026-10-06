/**
 * ITS - Email Service
 * Uses Nodemailer with SMTP. Falls back to console logging if SMTP not configured.
 */

const nodemailer = require('nodemailer');

let transporter = null;
let useConsole  = false;

function initEmail() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.log('SMTP not configured; emails will be logged to the console.');
    useConsole = true;
    return;
  }

  transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass }
  });

  transporter.verify((err) => {
    if (err) {
      console.warn('SMTP connection failed; falling back to console:', err.message);
      useConsole = true;
      transporter = null;
    } else {
      console.log('SMTP connected successfully.');
    }
  });
}

async function sendEmail({ to, subject, html }) {
  const from = process.env.SMTP_FROM || 'ITS Support <noreply@its.local>';

  if (useConsole || !transporter) {
    // ── Console fallback ────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(60));
    console.log('EMAIL (console fallback)');
    console.log(`  To:      ${to}`);
    console.log(`  Subject: ${subject}`);
    // Extract action link and User ID for easy copy-pasting during local testing
    const linkMatch = html.match(/href="([^"]+)"/);
    const idMatch   = html.match(/<div class="id">([^<]+)<\/div>/);

    if (idMatch) {
      console.log(`  USER ID:     ${idMatch[1]}`);
    }
    if (linkMatch) {
      console.log(`  ACTION LINK: ${linkMatch[1]}`);
    }

    const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    console.log(`  Body:           ${text.substring(0, 250)}${text.length > 250 ? '...' : ''}`);
    console.log('═'.repeat(60) + '\n');
    return { messageId: 'console-' + Date.now() };
  }

  return transporter.sendMail({ from, to, subject, html });
}

// ─── Email Templates ──────────────────────────────────────────────────────────

function emailLayout(title, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${title}</title>
  <style>
    body { margin:0; padding:0; background:#f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrap { max-width:600px; margin:40px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,.08); }
    .header { background:linear-gradient(135deg,#6366f1,#8b5cf6); padding:32px 40px; }
    .header h1 { margin:0; color:#fff; font-size:24px; font-weight:700; letter-spacing:-0.5px; }
    .header p { margin:4px 0 0; color:rgba(255,255,255,.8); font-size:14px; }
    .body { padding:40px; color:#374151; line-height:1.6; }
    .body h2 { font-size:20px; font-weight:600; color:#111827; margin:0 0 16px; }
    .body p { margin:0 0 16px; }
    .btn { display:inline-block; padding:14px 28px; background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; text-decoration:none; border-radius:8px; font-weight:600; font-size:15px; margin:8px 0 24px; }
    .id-box { background:#f9fafb; border:2px solid #e5e7eb; border-radius:8px; padding:16px 24px; margin:16px 0; text-align:center; }
    .id-box .id { font-size:28px; font-weight:700; color:#6366f1; letter-spacing:2px; font-family:monospace; }
    .id-box small { display:block; color:#6b7280; font-size:13px; margin-top:4px; }
    .ticket-box { background:#f9fafb; border-left:4px solid #6366f1; border-radius:4px; padding:16px 20px; margin:16px 0; }
    .ticket-box strong { display:block; font-size:13px; color:#6b7280; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px; }
    .badge { display:inline-block; padding:3px 10px; border-radius:100px; font-size:12px; font-weight:600; }
    .badge-critical { background:#fef2f2; color:#dc2626; }
    .badge-high { background:#fff7ed; color:#ea580c; }
    .badge-medium { background:#fffbeb; color:#d97706; }
    .badge-low { background:#f0fdf4; color:#16a34a; }
    .footer { background:#f9fafb; padding:20px 40px; text-align:center; color:#9ca3af; font-size:12px; border-top:1px solid #e5e7eb; }
    .warn { background:#fffbeb; border:1px solid #fcd34d; border-radius:8px; padding:12px 16px; color:#92400e; font-size:14px; margin:16px 0; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>ITS — IT Support</h1>
      <p>IT Support Ticketing System</p>
    </div>
    <div class="body">${content}</div>
    <div class="footer">
      <p>This is an automated message from ITS. Please do not reply to this email.</p>
      <p>© ${new Date().getFullYear()} IT Support Ticketing System</p>
    </div>
  </div>
</body>
</html>`;
}

// ── Account-created email ──────────────────────────────────────────────────────
async function sendAccountCreatedEmail(user, appUrl) {
  const html = emailLayout('Your ITS Login Details', `
    <h2>Welcome to ITS, ${user.full_name}!</h2>
    <p>Your account is ready. Use this User ID and the password you chose during registration to log in:</p>
    <div class="id-box">
      <div class="id">${user.user_id}</div>
      <small>Your User ID</small>
    </div>
    <a class="btn" href="${appUrl}/login.html">Go to Login</a>
    <p>For your security, your password is not included in this email.</p>
    <p>If you didn't create this account, please contact your IT support team.</p>
  `);
  return sendEmail({ to: user.email, subject: 'ITS — Your Login Details', html });
}

// ── Password reset email ───────────────────────────────────────────────────────
async function sendPasswordResetEmail(user, token, appUrl) {
  const link = `${appUrl}/reset-password?token=${token}`;
  const html  = emailLayout('Reset Your Password', `
    <h2>Password Reset Request</h2>
    <p>Hi ${user.full_name},</p>
    <p>We received a request to reset the password for your ITS account (<strong>${user.user_id}</strong>).</p>
    <a class="btn" href="${link}">Reset My Password</a>
    <div class="warn">This link expires in 2 hours. If you didn't request a reset, please ignore this email.</div>
  `);
  return sendEmail({ to: user.email, subject: 'ITS — Password Reset', html });
}

// ── Forgot User ID email ───────────────────────────────────────────────────────
async function sendForgotUserIdEmail(user, appUrl) {
  const html = emailLayout('Your User ID', `
    <h2>Your User ID</h2>
    <p>Hi ${user.full_name},</p>
    <p>You requested your ITS User ID. Here it is:</p>
    <div class="id-box">
      <div class="id">${user.user_id}</div>
      <small>Use this ID to log in at ITS</small>
    </div>
    <a class="btn" href="${appUrl}/login">Go to Login</a>
  `);
  return sendEmail({ to: user.email, subject: 'ITS — Your User ID', html });
}

// ── Ticket created email ───────────────────────────────────────────────────────
async function sendTicketCreatedEmail(user, ticket, appUrl) {
  const link = `${appUrl}/tickets/${ticket.ticket_id}`;
  const html  = emailLayout('Ticket Created', `
    <h2>Your ticket has been submitted</h2>
    <p>Hi ${user.full_name},</p>
    <p>We've received your support request. Our team will review it shortly.</p>
    <div class="ticket-box">
      <strong>Ticket ID</strong>${ticket.ticket_id}
      <br/><strong style="margin-top:8px;display:block;">Title</strong>${ticket.title}
      <br/><strong style="margin-top:8px;display:block;">Priority</strong>
      <span class="badge badge-${ticket.priority.toLowerCase()}">${ticket.priority}</span>
    </div>
    <a class="btn" href="${link}">View Ticket</a>
  `);
  return sendEmail({ to: user.email, subject: `ITS — Ticket Created [${ticket.ticket_id}]`, html });
}

// ── Ticket updated email ───────────────────────────────────────────────────────
async function sendTicketUpdatedEmail(user, ticket, update, appUrl) {
  const link = `${appUrl}/tickets/${ticket.ticket_id}`;
  const html  = emailLayout('Ticket Updated', `
    <h2>Your ticket has been updated</h2>
    <p>Hi ${user.full_name},</p>
    <div class="ticket-box">
      <strong>Ticket</strong>${ticket.ticket_id} — ${ticket.title}
      <br/><strong style="margin-top:8px;display:block;">Update</strong>${update}
    </div>
    <a class="btn" href="${link}">View Ticket</a>
  `);
  return sendEmail({ to: user.email, subject: `ITS — Ticket Updated [${ticket.ticket_id}]`, html });
}

// ── Ticket resolved — rating request ──────────────────────────────────────────
async function sendTicketResolvedEmail(user, ticket, appUrl) {
  const link = `${appUrl}/tickets/${ticket.ticket_id}`;
  const html  = emailLayout('Ticket Resolved', `
    <h2>Your ticket has been resolved ✅</h2>
    <p>Hi ${user.full_name},</p>
    <p>Ticket <strong>${ticket.ticket_id}</strong> — "${ticket.title}" has been marked as resolved.</p>
    <p>We'd love to hear how we did! Click below to rate your experience:</p>
    <a class="btn" href="${link}#rate">Rate My Experience</a>
    <p style="color:#6b7280;font-size:13px;">If you need further assistance, you can reopen the ticket from the link above.</p>
  `);
  return sendEmail({ to: user.email, subject: `ITS — Ticket Resolved [${ticket.ticket_id}]`, html });
}

module.exports = {
  initEmail,
  sendEmail,
  sendAccountCreatedEmail,
  sendPasswordResetEmail,
  sendForgotUserIdEmail,
  sendTicketCreatedEmail,
  sendTicketUpdatedEmail,
  sendTicketResolvedEmail
};
