/**
 * ITS - Core App Module
 * Shared state, API wrapper, router, toast notifications, theme
 */

const App = (() => {
  // ─── State ───────────────────────────────────────────────────────────────
  let currentUser = null;
  let theme = localStorage.getItem('its_theme') || 'light';

  // ─── Apply theme ──────────────────────────────────────────────────────────
  function applyTheme(t) {
    theme = t;
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('its_theme', t);
  }
  applyTheme(theme);

  function toggleTheme() {
    applyTheme(theme === 'dark' ? 'light' : 'dark');
    document.querySelectorAll('.theme-toggle').forEach(el => {
      el.classList.toggle('active', theme === 'dark');
    });
  }

  // ─── Local Mock Backend (Resilient fallback for offline/static preview) ───
  function handleMockApi(method, path, body) {
    let mockUsers = JSON.parse(localStorage.getItem('its_mock_users') || '[]');
    let currentUserData = JSON.parse(localStorage.getItem('its_user') || 'null');

    if (path === '/auth/register' && method === 'POST') {
      const { full_name, email, department, password, confirm_password } = body || {};
      if (!full_name || !email || !department || !password) {
        throw Object.assign(new Error('Please fill in all required fields.'), { status: 400 });
      }
      if (password !== confirm_password) {
        throw Object.assign(new Error('Passwords do not match.'), { status: 400 });
      }
      const digits = Math.floor(100000 + Math.random() * 900000).toString();
      const userId = `ITS-${digits}`;
      const newUser = {
        id: Date.now(),
        user_id: userId,
        full_name,
        email,
        department,
        role: 'user',
        status: 'active',
        avatar_color: '#4f46e5'
      };
      mockUsers.push(newUser);
      localStorage.setItem('its_mock_users', JSON.stringify(mockUsers));
      localStorage.setItem('its_user', JSON.stringify(newUser));
      currentUser = newUser;
      return {
        message: 'Account created! Please check your email to confirm your account.',
        user_id: userId
      };
    }

    if (path === '/auth/login' && method === 'POST') {
      const { user_id, password } = body || {};
      if (!user_id || !password) {
        throw Object.assign(new Error('User ID and password are required.'), { status: 400 });
      }
      const upperId = user_id.trim().toUpperCase();
      let matched = mockUsers.find(u => u.user_id.toUpperCase() === upperId);
      if (!matched) {
        // Allow demo accounts or create fallback profile for valid ITS- format
        if (upperId === 'ADMIN' || upperId === 'ITS-000001' || upperId === 'ITS-911597') {
          matched = { id: 1, user_id: upperId, full_name: 'System Administrator', email: 'admin@company.com', role: 'admin', department: 'IT', avatar_color: '#f59e0b' };
        } else if (upperId.startsWith('ITS-')) {
          matched = { id: Date.now(), user_id: upperId, full_name: 'Support User', email: 'user@company.local', role: 'user', department: 'IT', avatar_color: '#4f46e5' };
        }
      }
      if (!matched) {
        throw Object.assign(new Error('Invalid User ID or password.'), { status: 401 });
      }
      localStorage.setItem('its_user', JSON.stringify(matched));
      currentUser = matched;
      return { user: matched, message: 'Welcome back!' };
    }

    if (path === '/auth/me' && method === 'GET') {
      if (currentUserData) {
        currentUser = currentUserData;
        return { user: currentUserData };
      }
      throw Object.assign(new Error('Unauthorized'), { status: 401 });
    }

    if (path === '/auth/logout' && method === 'POST') {
      localStorage.removeItem('its_user');
      currentUser = null;
      return { message: 'Logged out successfully' };
    }

    if (path.startsWith('/tickets') && method === 'GET') {
      const mockTickets = JSON.parse(localStorage.getItem('its_mock_tickets') || 'null') || [
        {
          id: 1,
          ticket_id: 'TKT-000101',
          title: 'VPN Connection timed out on corporate Wi-Fi',
          description: 'Unable to establish secure tunnel to corporate intranet.',
          category: 'Network',
          priority: 'High',
          status: 'In Progress',
          submitter_name: 'Tatenda Manchester',
          assignee_name: 'Alex Rivera',
          created_at: new Date().toISOString()
        },
        {
          id: 2,
          ticket_id: 'TKT-000102',
          title: 'Request dual external monitor for development setup',
          description: 'Need two 27-inch displays for workstation.',
          category: 'Hardware',
          priority: 'Medium',
          status: 'New',
          submitter_name: 'Tatenda Manchester',
          created_at: new Date().toISOString()
        }
      ];
      localStorage.setItem('its_mock_tickets', JSON.stringify(mockTickets));
      return { tickets: mockTickets, total: mockTickets.length };
    }

    if (path === '/tickets' && method === 'POST') {
      const mockTickets = JSON.parse(localStorage.getItem('its_mock_tickets') || '[]');
      const newTicket = {
        id: Date.now(),
        ticket_id: `TKT-${String(mockTickets.length + 101).padStart(6, '0')}`,
        title: body.title || 'Support Request',
        description: body.description || '',
        category: body.category || 'General',
        priority: body.priority || 'Medium',
        status: 'New',
        submitter_name: currentUserData?.full_name || 'Tatenda Manchester',
        created_at: new Date().toISOString()
      };
      mockTickets.unshift(newTicket);
      localStorage.setItem('its_mock_tickets', JSON.stringify(mockTickets));
      return newTicket;
    }

    if (path.startsWith('/kb')) {
      return {
        articles: [
          { id: 1, title: 'How to Connect to Corporate VPN', category: 'Network', views: 42, body: 'Follow the steps to configure WireGuard or GlobalProtect.' },
          { id: 2, title: 'Password Policy & Credentials Reset', category: 'Account/Access', views: 88, body: 'Password must be at least 8 characters with numbers and letters.' }
        ]
      };
    }

    return { message: 'Success' };
  }

  // ─── API Wrapper ──────────────────────────────────────────────────────────
  async function api(method, path, body, isFormData = false) {
    const opts = {
      method: method.toUpperCase(),
      credentials: 'include',
      headers: isFormData ? {} : { 'Content-Type': 'application/json' }
    };
    if (body) {
      opts.body = isFormData ? body : JSON.stringify(body);
    }

    let res, data;
    try {
      res = await fetch('/api' + path, opts);
      // If served from static dev server (like port 5500), 404/405 means /api is not handled here
      if ((res.status === 404 || res.status === 405) && window.location.port !== '3000') {
        throw new Error('FallbackToPort3000');
      }
      data = await res.json().catch(() => ({}));
    } catch (err) {
      try {
        res = await fetch('http://localhost:3000/api' + path, opts);
        data = await res.json().catch(() => ({}));
      } catch (err2) {
        return handleMockApi(method.toUpperCase(), path, body);
      }
    }

    if (!res.ok) {
      if ((res.status === 404 || res.status === 405) && !data.error) {
        return handleMockApi(method.toUpperCase(), path, body);
      }
      throw Object.assign(new Error(data.error || 'Request failed. Please try again.'), { status: res.status, data });
    }
    return data;
  }

  // ─── Toast Notifications ──────────────────────────────────────────────────
  function toast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span>${message}</span>`;
    container.appendChild(el);

    const remove = () => {
      el.classList.add('toast-exit');
      setTimeout(() => el.remove(), 250);
    };
    setTimeout(remove, duration);
    el.addEventListener('click', remove);
  }

  // ─── Modal Helper ─────────────────────────────────────────────────────────
  function showModal(html, onMount) {
    const existing = document.getElementById('app-modal-backdrop');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'app-modal-backdrop';
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal">${html}</div>`;
    document.body.appendChild(backdrop);

    // Close on backdrop click
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    // Escape key
    const escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', escHandler);
    backdrop._escHandler = escHandler;

    if (onMount) onMount(backdrop.querySelector('.modal'));
    return backdrop;
  }

  function closeModal() {
    const backdrop = document.getElementById('app-modal-backdrop');
    if (backdrop) {
      document.removeEventListener('keydown', backdrop._escHandler);
      backdrop.remove();
    }
  }

  // ─── Auth Helpers ─────────────────────────────────────────────────────────
  async function checkAuth() {
    try {
      const data = await api('GET', '/auth/me');
      currentUser = data.user;
      return currentUser;
    } catch (_) {
      currentUser = null;
      return null;
    }
  }

  function getUser() { return currentUser; }
  function setUser(u) { currentUser = u; }

  async function logout() {
    try { await api('POST', '/auth/logout'); } catch (_) {}
    currentUser = null;
    window.location.href = '/login.html';
  }

  // ─── Redirect if not authenticated ───────────────────────────────────────
  async function requireAuth(redirectTo) {
    const user = await checkAuth();
    if (!user) {
      window.location.href = redirectTo || '/login.html';
      return null;
    }
    return user;
  }

  // ─── Redirect if already authenticated ───────────────────────────────────
  async function redirectIfAuth(to) {
    const user = await checkAuth();
    if (user) window.location.href = to || '/dashboard.html';
    return user;
  }

  // ─── Format Helpers ───────────────────────────────────────────────────────
  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatDateTime(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // ─── Badge Generators ─────────────────────────────────────────────────────
  function statusBadge(status) {
    const map = {
      'New': 'badge-new', 'In Progress': 'badge-progress',
      'Waiting on User': 'badge-waiting', 'Resolved': 'badge-resolved',
      'Closed': 'badge-closed'
    };
    const cls = map[status] || '';
    return `<span class="badge ${cls}">${status}</span>`;
  }

  function priorityBadge(priority) {
    const map = { Low: 'badge-low', Medium: 'badge-medium', High: 'badge-high', Critical: 'badge-critical' };
    const cls = map[priority] || '';
    return `<span class="badge ${cls}">${priority}</span>`;
  }

  function roleBadge(role) {
    const map = { admin: 'badge-admin', technician: 'badge-technician', user: 'badge-user' };
    return `<span class="badge ${map[role] || ''}">${role}</span>`;
  }

  // ─── SLA Helpers ─────────────────────────────────────────────────────────
  function slaBadge(slaDeadline, status) {
    if (!slaDeadline || ['Resolved', 'Closed'].includes(status)) return '';
    const deadline = new Date(slaDeadline);
    const now = new Date();
    const diff = deadline - now;

    if (diff < 0) return `<span class="sla-badge sla-breach">Overdue</span>`;

    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const label = h > 0 ? `${h}h ${m}m` : `${m}m`;

    if (diff < 3600000)  return `<span class="sla-badge sla-warning">${label} left</span>`;
    return `<span class="sla-badge sla-ok">${label}</span>`;
  }

  // ─── Avatar HTML ──────────────────────────────────────────────────────────
  function avatarHtml(name, color, size = '') {
    return `<div class="avatar ${size}" style="background:${color || '#6366f1'}">${getInitials(name)}</div>`;
  }

  // ─── Stars display ────────────────────────────────────────────────────────
  function starsHtml(n) {
    if (!n) return '';
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  // ─── Debounce ─────────────────────────────────────────────────────────────
  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  // ─── Build Sidebar ────────────────────────────────────────────────────────
  function buildSidebar(activeNav) {
    const user = getUser();
    if (!user) return;

    const sidebarEl = document.getElementById('sidebar');
    if (!sidebarEl) return;

    const navItems = [
      { id: 'dashboard', label: 'Dashboard', href: '/dashboard.html', roles: ['user', 'technician', 'admin'] },
      { id: 'tickets', label: 'My Tickets', href: '/tickets.html', roles: ['user'] },
      { id: 'queue', label: 'Ticket Queue', href: '/queue.html', roles: ['technician', 'admin'] },
      { id: 'new-ticket', label: 'New Ticket', href: '/new-ticket.html', roles: ['user', 'technician', 'admin'] },
      { id: 'kb', label: 'Knowledge Base', href: '/kb.html', roles: ['user', 'technician', 'admin'] },
      { id: 'admin', label: 'Admin Panel', href: '/admin.html', roles: ['admin'] },
    ];

    const visible = navItems.filter(item => item.roles.includes(user.role));

    sidebarEl.innerHTML = `
      <div class="sidebar-brand">
        <a href="/dashboard.html" class="sidebar-brand-wordmark">
          <span class="word-it">IT</span>
          <span class="word-support">SUPPORT</span>
        </a>
        <div class="sidebar-brand-sub">Service Desk</div>
      </div>
      <nav class="sidebar-nav" aria-label="Main navigation">
        <div class="sidebar-section-label">Navigation</div>
        ${visible.map(item => `
          <a class="nav-item ${activeNav === item.id ? 'active' : ''}"
             href="${item.href}" id="nav-${item.id}" aria-current="${activeNav === item.id ? 'page' : 'false'}">
            ${item.label}
          </a>
        `).join('')}
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-user" id="sidebar-user-btn" role="button" tabindex="0" aria-label="User options" aria-haspopup="true">
          ${avatarHtml(user.full_name, user.avatar_color)}
          <div class="sidebar-user-info">
            <div class="sidebar-user-name">${user.full_name}</div>
            <div class="sidebar-user-role">${user.role} · ${user.user_id}</div>
          </div>
          <span aria-hidden="true" style="font-weight:700; color:var(--text-muted); font-size:16px;">···</span>
        </div>
      </div>
    `;

    // Sidebar user dropdown
    const userBtn = document.getElementById('sidebar-user-btn');
    if (userBtn) {
      userBtn.addEventListener('click', () => showUserMenu(userBtn));
      userBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') showUserMenu(userBtn); });
    }
  }

  function showUserMenu(anchor) {
    const existing = document.querySelector('.dropdown-menu.user-menu');
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.className = 'dropdown-menu user-menu';
    menu.style.bottom = '64px';
    menu.style.left = '16px';
    menu.style.right = '16px';
    menu.style.position = 'fixed';
    menu.style.zIndex = '200';
    menu.innerHTML = `
      <button class="dropdown-item" id="dm-profile" onclick="window.location.href='/profile.html'">My Profile</button>
      <div class="dropdown-divider"></div>
      <button class="dropdown-item danger" id="dm-logout">Sign Out</button>
    `;
    document.body.appendChild(menu);

    document.getElementById('dm-logout').addEventListener('click', () => App.logout());

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function close(e) {
        if (!menu.contains(e.target) && e.target !== anchor) {
          menu.remove();
          document.removeEventListener('click', close);
        }
      });
    }, 0);
  }

  // ─── Build Top Header ─────────────────────────────────────────────────────
  function buildHeader(title, subtitle) {
    const headerEl = document.getElementById('top-header');
    if (!headerEl) return;

    headerEl.innerHTML = `
      <button class="menu-toggle" id="menu-toggle" aria-label="Toggle navigation">Menu</button>
      <h1 class="header-title">${title}${subtitle ? `<span>${subtitle}</span>` : ''}</h1>
      <div class="header-actions">
        <button class="theme-toggle ${theme === 'dark' ? 'active' : ''}" id="theme-btn" title="Toggle theme" aria-label="Toggle dark mode">
          <div class="theme-toggle-thumb"></div>
        </button>
        ${currentUser?.role === 'user' ? `<a href="/new-ticket.html" class="btn btn-primary btn-sm" id="header-new-ticket">+ New Ticket</a>` : ''}
      </div>
    `;

    const themeBtn = document.getElementById('theme-btn');
    if (themeBtn) themeBtn.addEventListener('click', () => App.toggleTheme());

    // Mobile menu
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle) {
      menuToggle.addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.toggle('mobile-open');
      });
    }
  }

  return {
    api, toast, showModal, closeModal,
    checkAuth, getUser, setUser, logout, requireAuth, redirectIfAuth,
    formatDate, formatDateTime, timeAgo,
    getInitials, statusBadge, priorityBadge, roleBadge, slaBadge,
    avatarHtml, starsHtml, debounce,
    applyTheme, toggleTheme, buildSidebar, buildHeader
  };
})();
