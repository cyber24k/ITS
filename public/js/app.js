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
      const thumb = el.querySelector('.theme-toggle-thumb');
      if (thumb) thumb.textContent = theme === 'dark' ? '🌙' : '☀️';
    });
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

    const res = await fetch('/api' + path, opts);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
    }
    return data;
  }

  // ─── Toast Notifications ──────────────────────────────────────────────────
  function toast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
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
    const icon = {
      'New': '🆕', 'In Progress': '🔧', 'Waiting on User': '⏳',
      'Resolved': '✅', 'Closed': '🔒'
    };
    const cls = map[status] || '';
    return `<span class="badge ${cls}">${icon[status] || ''} ${status}</span>`;
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

    if (diff < 0) return `<span class="sla-badge sla-breach">🔴 Overdue</span>`;

    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const label = h > 0 ? `${h}h ${m}m` : `${m}m`;

    if (diff < 3600000)  return `<span class="sla-badge sla-warning">⚠️ ${label}</span>`;
    return `<span class="sla-badge sla-ok">⏱️ ${label}</span>`;
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
      { id: 'dashboard', icon: '🏠', label: 'Dashboard', href: '/dashboard.html', roles: ['user', 'technician', 'admin'] },
      { id: 'tickets', icon: '🎫', label: 'My Tickets', href: '/tickets.html', roles: ['user'] },
      { id: 'queue', icon: '📋', label: 'Ticket Queue', href: '/queue.html', roles: ['technician', 'admin'] },
      { id: 'new-ticket', icon: '➕', label: 'New Ticket', href: '/new-ticket.html', roles: ['user', 'technician', 'admin'] },
      { id: 'kb', icon: '📚', label: 'Knowledge Base', href: '/kb.html', roles: ['user', 'technician', 'admin'] },
      { id: 'admin', icon: '⚙️', label: 'Admin Panel', href: '/admin.html', roles: ['admin'] },
    ];

    const visible = navItems.filter(item => item.roles.includes(user.role));

    sidebarEl.innerHTML = `
      <div class="sidebar-brand">
        <div class="sidebar-brand-icon">🖥️</div>
        <div class="sidebar-brand-text">
          <div class="sidebar-brand-name">ITS</div>
          <div class="sidebar-brand-sub">IT Support</div>
        </div>
      </div>
      <nav class="sidebar-nav" aria-label="Main navigation">
        <div class="sidebar-section-label">Navigation</div>
        ${visible.map(item => `
          <a class="nav-item ${activeNav === item.id ? 'active' : ''}"
             href="${item.href}" id="nav-${item.id}" aria-current="${activeNav === item.id ? 'page' : 'false'}">
            <span class="nav-icon" aria-hidden="true">${item.icon}</span>
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
          <span aria-hidden="true">⋯</span>
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
      <button class="dropdown-item" id="dm-profile" onclick="window.location.href='/profile.html'">👤 My Profile</button>
      <div class="dropdown-divider"></div>
      <button class="dropdown-item danger" id="dm-logout">🚪 Sign Out</button>
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
      <button class="menu-toggle" id="menu-toggle" aria-label="Toggle navigation">☰</button>
      <h1 class="header-title">${title}${subtitle ? `<span>${subtitle}</span>` : ''}</h1>
      <div class="header-actions">
        <button class="theme-toggle ${theme === 'dark' ? 'active' : ''}" id="theme-btn" title="Toggle theme" aria-label="Toggle dark mode">
          <div class="theme-toggle-thumb">${theme === 'dark' ? '🌙' : '☀️'}</div>
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
