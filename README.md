# 🖥️ ITS — IT Support Ticketing System

A modern, responsive, and robust IT Support Ticketing System built with vanilla JavaScript, HTML5, CSS3, and Node.js with Express and SQLite.

---

## ✨ Features & Architecture

### 🔐 Account Creation & Login
- **Unique Human-Friendly User ID:** Users register with their full name, email, department, and password. On successful registration, the system generates a unique **`ITS-XXXXXX`** (6-digit) identifier.
- **Email Verification Flow:** Accounts are created with `unconfirmed` status. A secure 24-hour token is generated and emailed to the user containing their assigned User ID and a confirmation button/link.
- **Login with User ID:** Login requires the generated User ID + password (email is not accepted for login).
- **Unconfirmed Account Protection:** Unconfirmed accounts are blocked from logging in with a friendly error and a 1-click option to resend the confirmation link.
- **Account Recovery:**
  - **Forgot User ID:** User enters their registered email to receive their User ID.
  - **Password Reset:** Generates a secure, expiring (2-hour) password reset token delivered via email.
- **Enterprise Security:**
  - Passwords hashed with `bcrypt` (12 rounds).
  - JWT tokens stored in secure, `httpOnly`, `SameSite=Lax` cookies.
  - Express rate limiters applied to registration, login, and email endpoints.
  - Parameterized SQLite queries protecting against SQL injection.
  - XSS sanitization on all user-submitted text.
  - Timing attack mitigation on login validation.

---

### 👥 Role-Based Access Control (RBAC)
1. **User:**
   - Submit new support requests with category, priority, and attachments.
   - Real-time Knowledge Base suggestions while typing ticket titles.
   - View their open and resolved tickets.
   - Reply to support threads.
   - Rate resolved tickets (1–5 stars and feedback).
2. **Technician:**
   - Dedicated Ticket Queue with tabs: *Unassigned Queue*, *My Tickets*, *SLA Warnings*, and *All Open*.
   - 1-click "Claim Ticket" or assign/reassign to other technicians.
   - Update ticket status (*New*, *In Progress*, *Waiting on User*, *Resolved*, *Closed*).
   - Post private **Internal Staff Notes** (highlighted in amber and completely hidden from standard users).
   - Create, edit, and publish Knowledge Base articles.
3. **Admin:**
   - Executive Dashboard with interactive Chart.js visualizations:
     - Tickets by Status (Doughnut chart)
     - Tickets by Category (Bar chart)
     - Tickets by Priority (Pie chart)
     - 30-Day Ticket Volume (Line chart)
     - Customer Satisfaction Scores (Histogram)
     - Top Technicians table with resolution count and rating averages
   - Full User Directory & Role Management: Promote/demote users between User, Technician, and Admin roles; suspend or activate accounts.

---

### ⏱️ SLA Tracking & Visual Alerts
- Automatic SLA resolution targets based on ticket priority:
  - **Critical:** 1 Hour (Red highlight, breach warnings)
  - **High:** 4 Hours
  - **Medium:** 8 Hours
  - **Low:** 24 Hours
- Real-time SLA countdown badges and automatic **🔴 Overdue** flags.

---

### 📚 Self-Service Knowledge Base
- Searchable articles by keyword or category (*General*, *Hardware*, *Software*, *Network*, *Account/Access*, *Email*, *Security*).
- Real-time typeahead suggestions on the "New Ticket" page to resolve issues before submission.
- View count tracking and staff article editor.

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js** v18+ (tested on Node v20)
- **npm** (comes with Node.js)

### 2. Installation
Clone or navigate to the project directory:
```bash
cd "IT SUPPORT"
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default configuration in `.env`:
```env
PORT=3000
NODE_ENV=development
JWT_SECRET=its-super-secret-jwt-key-change-in-production-2024
APP_URL=http://localhost:3000

# SMTP (leave blank to log all emails to the terminal console)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=ITS Support <noreply@its.local>

# Seeded Admin Account
ADMIN_EMAIL=admin@its.local
ADMIN_PASSWORD=Admin1234
ADMIN_NAME=System Administrator

TOKEN_EXPIRY=7d
CONFIRMATION_TOKEN_EXPIRY_HOURS=24
RESET_TOKEN_EXPIRY_HOURS=2
```

### 4. Running the Application
```bash
npm start
```
The server will start at **http://localhost:3000**.

---

## 🔑 Pre-Seeded Accounts (First Run)

When the server starts for the first time, SQLite (`its.db`) is automatically initialized and seeded:

| Role | Name | User ID | Email | Password |
|---|---|---|---|---|
| **Admin** | System Administrator | *Auto-generated (e.g. `ITS-534575`)* | `admin@its.local` | `Admin1234` |
| **Technician** | Alex Rivera | *Auto-generated (e.g. `ITS-506335`)* | `tech@its.local` | `Tech1234` |

*(Note: The exact User IDs for seeded staff are printed to the terminal console on first run, or you can find them in the `its.db` database).*

---

## 📧 Testing the Email Flow (Local Development)

By default, SMTP settings in `.env` are left empty. **All emails are automatically logged to the terminal console with formatted headers and 1-click links:**

1. Navigate to **http://localhost:3000/register.html** and register a new user.
2. Look at your server terminal console. You will see:
   ```text
   ════════════════════════════════════════════════════════════
   📧 EMAIL (console fallback)
     To:          jane.doe@example.com
     Subject:     ITS — Confirm Your Account
     🔑 USER ID:  ITS-123456
     🔗 ACTION LINK: http://localhost:3000/confirm-email?token=...
   ════════════════════════════════════════════════════════════
   ```
3. Copy and open the `ACTION LINK` in your browser.
4. Your account is immediately activated, and you are redirected to login using your new `ITS-XXXXXX` User ID!

To use a live email server (e.g. SendGrid, Mailgun, Amazon SES, or Gmail SMTP), simply fill in `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` in your `.env` file.

---

## 🧪 Running Automated Tests

Run the complete end-to-end test suite:
```bash
node server/test-e2e.js
```
The test suite validates:
- Registration validation & User ID format
- Unconfirmed account blocking
- Token email confirmation
- User ID + password login
- Real-time Knowledge Base search
- Ticket creation & attachments
- Public comments & staff-only internal notes isolation
- Technician ticket assignment & SLA updates
- Ticket resolution & 5-star customer ratings
- Admin reports & metrics calculation
- Forgot User ID and Password Reset tokens

---

## 📁 Project Structure

```text
IT SUPPORT/
├── public/                      # Frontend (Pure HTML, CSS, Vanilla JS)
│   ├── css/
│   │   └── style.css            # Unified Design System, tokens, light/dark themes
│   ├── js/
│   │   └── app.js               # Auth, API client, sidebar, header, toasts
│   ├── index.html               # Landing page / auth router
│   ├── login.html               # User ID + password login
│   ├── register.html            # Registration form with live validation
│   ├── confirm-email.html       # Email confirmation & token handler
│   ├── forgot-user-id.html      # Forgot User ID recovery
│   ├── forgot-password.html     # Forgot password request
│   ├── reset-password.html      # Password reset with token validation
│   ├── dashboard.html           # Role-aware dashboard (User/Tech/Admin with charts)
│   ├── tickets.html             # User's ticket list with search & filters
│   ├── queue.html               # Technician queue with tabs & quick claim
│   ├── new-ticket.html          # New ticket form with real-time KB suggestions
│   ├── ticket-detail.html       # Ticket details, timeline, internal notes, ratings
│   ├── kb.html                  # Knowledge Base viewer and editor
│   ├── admin.html               # User management table & role assignment
│   ├── profile.html             # User profile, User ID copy, password change
│   └── uploads/                 # Uploaded screenshots & attachments
│
├── server/                      # Backend (Node.js + Express)
│   ├── db/
│   │   └── database.js          # SQLite connection, schema tables & seeding
│   ├── email/
│   │   └── mailer.js            # Nodemailer with console fallback & templates
│   ├── middleware/
│   │   └── auth.js              # JWT authentication & role-guard middleware
│   ├── routes/
│   │   ├── auth.js              # Register, login, confirm, forgot ID/pass
│   │   ├── tickets.js           # Tickets CRUD, comments, notes, SLA, ratings
│   │   ├── admin.js             # User management, reports & metrics
│   │   └── kb.js                # Knowledge Base CRUD & real-time search
│   ├── index.js                 # Server entry point, static files & routing
│   ├── test-e2e.js              # Comprehensive E2E test suite
│   └── utils.js                 # Helper functions (ID generation, SLA, tokens)
│
├── .env.example                 # Example environment variables
├── package.json                 # Node dependencies and scripts
└── README.md                    # Project documentation
```

---

## 🎨 Design Philosophy
- **Light & Dark Mode:** 1-click toggle with smooth transitions and persistent `localStorage` preference.
- **Accessible & Semantic:** HTML5 landmarks, ARIA labels, and keyboard navigation.
- **Glassmorphism & Gradients:** Curated HSL color palette, clean typography (`Inter`), and responsive layout that adapts seamlessly to desktop, tablet, and mobile viewports.
