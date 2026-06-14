// The UI server proxies /api/* and /auth/* to the backend. Keep requests same-origin.
const API_BASE_URL = window.__API_BASE_URL__ || '';
const TOKEN_STORAGE = 'hubspot_audit_auth_token';
const CLIENT_KEY_STORAGE = 'hubspot_audit_client_key';
const PORTAL_ID_STORAGE = 'hubspot_audit_portal_id';
const AI_PROMPT_MODE_STORAGE = 'hubspot_audit_ai_prompt_mode';
const AI_PENDING_JOB_STORAGE = 'hubspot_audit_pending_ai_job';
const SIDEBAR_COLLAPSED_STORAGE = 'hubspot_audit_sidebar_collapsed';
const APP_DATA_CHANGE_STORAGE = 'hubspot_audit_data_change';
const APP_DATA_CHANGE_EVENT = 'hubspot-audit:data-changed';
const APP_LOADING_CLASS = 'app-loading';
const missingElementCache = new Map();
let appDataChangeSeq = 0;
const APP_INSTANCE_ID =
  window.crypto && typeof window.crypto.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function createMissingElement(id) {
  if (missingElementCache.has(id)) {
    return missingElementCache.get(id);
  }

  const noop = () => {};
  const stub = new Proxy(
    {
      id,
      style: {},
      classList: {
        add: noop,
        remove: noop,
        contains: () => false,
        toggle: () => false
      },
      addEventListener: noop,
      removeEventListener: noop,
      setAttribute: noop,
      removeAttribute: noop,
      focus: noop,
      blur: noop,
      click: noop,
      scrollIntoView: noop,
      querySelectorAll: () => [],
      querySelector: () => null,
      getContext: () => null,
      appendChild: noop,
      insertAdjacentHTML: noop
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return undefined;
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      }
    }
  );

  missingElementCache.set(id, stub);
  return stub;
}

function $(id) {
  return document.getElementById(id) || createMissingElement(id);
}

function authToken() {
  return window.localStorage.getItem(TOKEN_STORAGE);
}

function authHeaders() {
  const token = authToken();
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

async function apiFetch(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      cache: options.cache || 'no-store',
      headers: {
        ...authHeaders(),
        ...(options.headers || {})
      }
    });
  } catch (networkError) {
    const error = new Error(
      'Network error: UI cannot reach the API. Make sure both servers are running (npm start, npm run ui).'
    );
    error.cause = networkError;
    throw error;
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body && body.error && body.error.message ? body.error.message : 'Request failed';
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body.data;
}

function createDataChangePayload(detail = {}) {
  const payload = detail && typeof detail === 'object' ? { ...detail } : {};
  payload.type = typeof payload.type === 'string' && payload.type.trim() ? payload.type.trim() : 'data:changed';
  payload.at = Date.now();
  payload.seq = ++appDataChangeSeq;
  payload.originTabId = APP_INSTANCE_ID;
  return payload;
}

function broadcastDataChange(detail = {}) {
  const payload = createDataChangePayload(detail);

  try {
    window.localStorage.setItem(APP_DATA_CHANGE_STORAGE, JSON.stringify(payload));
  } catch {
    // Ignore storage failures; same-tab listeners still receive the custom event.
  }

  window.dispatchEvent(new CustomEvent(APP_DATA_CHANGE_EVENT, { detail: payload }));
  return payload;
}

function onDataChange(handler) {
  if (typeof handler !== 'function') {
    return () => {};
  }

  const customEventHandler = (event) => {
    if (!event || !event.detail) return;
    if (event.detail.originTabId && event.detail.originTabId === APP_INSTANCE_ID) return;
    handler(event.detail);
  };

  const storageEventHandler = (event) => {
    if (!event || event.key !== APP_DATA_CHANGE_STORAGE || !event.newValue) return;
    try {
      const payload = JSON.parse(event.newValue);
      if (payload && payload.originTabId && payload.originTabId === APP_INSTANCE_ID) return;
      handler(payload);
    } catch {
      // Ignore malformed payloads.
    }
  };

  window.addEventListener(APP_DATA_CHANGE_EVENT, customEventHandler);
  window.addEventListener('storage', storageEventHandler);

  return () => {
    window.removeEventListener(APP_DATA_CHANGE_EVENT, customEventHandler);
    window.removeEventListener('storage', storageEventHandler);
  };
}

const STATIC_ICON_SPECS = {
  bars: {
    size: 18,
    viewBox: '0 0 24 24',
    shapes: [
      { type: 'line', x1: 4, y1: 6.5, x2: 20, y2: 6.5 },
      { type: 'line', x1: 4, y1: 12, x2: 20, y2: 12 },
      { type: 'line', x1: 4, y1: 17.5, x2: 20, y2: 17.5 }
    ]
  },
  'circle-question': {
    size: 18,
    viewBox: '0 0 24 24',
    shapes: [
      { type: 'circle', cx: 12, cy: 12, r: 9 },
      { type: 'path', d: 'M9.3 9.2a2.8 2.8 0 1 1 4.6 2.1c-.8.6-1.4 1.1-1.4 2.3v.4' },
      { type: 'circle', cx: 12, cy: 17.2, r: 0.9, fill: 'currentColor', stroke: 'none' }
    ]
  },
  'chevron-down': {
    size: 14,
    viewBox: '0 0 24 24',
    shapes: [{ type: 'polyline', points: '6 9 12 15 18 9' }]
  },
  house: {
    size: 20,
    viewBox: '0 0 24 24',
    shapes: [
      { type: 'path', d: 'M4 11.2 12 4l8 7.2' },
      { type: 'path', d: 'M6 10.4V20a1 1 0 0 0 1 1h4.5v-5.5h1V21H17a1 1 0 0 0 1-1v-9.6' },
      { type: 'path', d: 'M4 11.2h16' }
    ]
  },
  'clipboard-list': {
    size: 20,
    viewBox: '0 0 24 24',
    shapes: [
      { type: 'path', d: 'M9 4h6a1 1 0 0 1 1 1v1h1.5A1.5 1.5 0 0 1 19 7.5v11A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5v-11A1.5 1.5 0 0 1 6.5 6H8V5a1 1 0 0 1 1-1Z' },
      { type: 'path', d: 'M9 6h6V5H9z' },
      { type: 'line', x1: 9, y1: 10, x2: 15, y2: 10 },
      { type: 'line', x1: 9, y1: 13, x2: 15, y2: 13 },
      { type: 'line', x1: 9, y1: 16, x2: 13, y2: 16 }
    ]
  },
  'shield-heart': {
    size: 20,
    viewBox: '0 0 24 24',
    shapes: [
      { type: 'path', d: 'M12 3 5 6v5c0 4.9 3.1 9.1 7 10 3.9-.9 7-5.1 7-10V6z' },
      { type: 'path', d: 'M12 16.5 9.3 14c-1.2-1-2.2-1.9-2.2-3.3A2.7 2.7 0 0 1 9.8 8c1 0 1.8.5 2.2 1.3.4-.8 1.2-1.3 2.2-1.3a2.7 2.7 0 0 1 2.7 2.7c0 1.4-1 2.3-2.2 3.3Z' }
    ]
  },
  'circle-dollar-to-slot': {
    size: 20,
    viewBox: '0 0 24 24',
    shapes: [
      { type: 'circle', cx: 12, cy: 12, r: 9 },
      { type: 'path', d: 'M12 6.5v11' },
      { type: 'path', d: 'M14.7 9.2c0-1.3-1.2-2.2-2.7-2.2s-2.7.9-2.7 2.2c0 1.2 1 1.9 2.7 2.2 1.7.3 2.7 1 2.7 2.2 0 1.3-1.2 2.2-2.7 2.2s-2.7-.9-2.7-2.2' }
    ]
  },
  'magnifying-glass': {
    size: 18,
    viewBox: '0 0 24 24',
    shapes: [
      { type: 'circle', cx: 11, cy: 11, r: 7 },
      { type: 'line', x1: 16.2, y1: 16.2, x2: 20, y2: 20 }
    ]
  },
  rotate: {
    size: 18,
    viewBox: '0 0 24 24',
    shapes: [
      { type: 'path', d: 'M21 12a9 9 0 0 1-15.4 6.4' },
      { type: 'path', d: 'M3 12A9 9 0 0 1 18.4 5.6' },
      { type: 'polyline', points: '18 2 18.4 5.6 15 6' },
      { type: 'polyline', points: '6 22 5.6 18.4 9 18' }
    ]
  },
  'arrow-left': {
    size: 18,
    viewBox: '0 0 24 24',
    shapes: [
      { type: 'line', x1: 19, y1: 12, x2: 5, y2: 12 },
      { type: 'polyline', points: '12 5 5 12 12 19' }
    ]
  },
  document: {
    size: 28,
    viewBox: '0 0 24 24',
    shapes: [
      { type: 'path', d: 'M7 3h7l5 5v13H7z' },
      { type: 'path', d: 'M14 3v5h5' },
      { type: 'line', x1: 9, y1: 12, x2: 15, y2: 12 },
      { type: 'line', x1: 9, y1: 15, x2: 15, y2: 15 }
    ]
  },
  shield: {
    size: 28,
    viewBox: '0 0 24 24',
    shapes: [{ type: 'path', d: 'M12 3 5 6v5c0 4.9 3.1 9.1 7 10 3.9-.9 7-5.1 7-10V6z' }]
  },
  eye: {
    size: 28,
    viewBox: '0 0 24 24',
    shapes: [
      { type: 'path', d: 'M2.5 12s3.4-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.4 6.5-9.5 6.5S2.5 12 2.5 12Z' },
      { type: 'circle', cx: 12, cy: 12, r: 2.7 }
    ]
  },
  info: {
    size: 28,
    viewBox: '0 0 24 24',
    shapes: [
      { type: 'circle', cx: 12, cy: 12, r: 9 },
      { type: 'line', x1: 12, y1: 10.2, x2: 12, y2: 15 },
      { type: 'circle', cx: 12, cy: 7.4, r: 0.9, fill: 'currentColor', stroke: 'none' }
    ]
  }
};

function createStaticIcon(name) {
  const spec = STATIC_ICON_SPECS[name];
  if (!spec) return null;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', spec.viewBox || '0 0 24 24');
  svg.setAttribute('width', String(spec.size || 20));
  svg.setAttribute('height', String(spec.size || 20));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('uiIcon');

  (spec.shapes || []).forEach((shape) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', shape.type);
    Object.entries(shape).forEach(([key, value]) => {
      if (key === 'type') return;
      node.setAttribute(key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`), String(value));
    });
    svg.appendChild(node);
  });

  return svg;
}

function replaceIconNode(node, iconName) {
  const svg = createStaticIcon(iconName);
  if (!svg) return false;

  Array.from(node.classList || []).forEach((className) => {
    if (!className.startsWith('fa-')) {
      svg.classList.add(className);
    }
  });

  node.replaceWith(svg);
  return true;
}

function initStaticIcons(root = document) {
  const variantClasses = new Set(['fa-solid', 'fa-regular', 'fa-brands', 'fa-light', 'fa-thin']);

  root.querySelectorAll('i[class*="fa-"]').forEach((node) => {
    const iconClass = Array.from(node.classList).find(
      (className) => className.startsWith('fa-') && !variantClasses.has(className)
    );
    if (!iconClass) return;
    replaceIconNode(node, iconClass.slice(3));
  });

  root.querySelectorAll('[data-ui-icon]').forEach((node) => {
    const iconName = String(node.getAttribute('data-ui-icon') || '').trim();
    if (!iconName) return;
    replaceIconNode(node, iconName);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setAppReady() {
  document.documentElement.classList.remove(APP_LOADING_CLASS);
}

function setAppLoading() {
  document.documentElement.classList.add(APP_LOADING_CLASS);
}

function getSidebarCollapsed() {
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE) === '1';
}

function setSidebarCollapsed(collapsed) {
  window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE, collapsed ? '1' : '0');
  document.body.classList.toggle('sidebar-collapsed', Boolean(collapsed));

  const button = document.getElementById('sidebarToggleBtn');
  if (button) {
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    button.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  }
}

function initSidebarToggle() {
  const button = document.getElementById('sidebarToggleBtn');
  if (!button) return;
  setSidebarCollapsed(getSidebarCollapsed());
  button.addEventListener('click', () => {
    setSidebarCollapsed(!getSidebarCollapsed());
  });
}

function getDashboardRouteTarget(pathname) {
  const path = String(pathname || '').toLowerCase();
  if (path.includes('/audit/')) return 'audits';
  if (path.includes('/dashboard/audits')) return 'audits';
  if (path.includes('/dashboard/privacy')) return 'privacy';
  if (path.includes('/dashboard/profile')) return 'profile';
  return 'accounts';
}

function initDashboardNavigation() {
  const navButtons = Array.from(document.querySelectorAll('[data-dashboard-target]'));
  if (!navButtons.length) return;

  const currentTarget = getDashboardRouteTarget(window.location.pathname);
  navButtons.forEach((button) => {
    const target = button.getAttribute('data-dashboard-target');
    button.classList.toggle('active', target === currentTarget);
  });

  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.getAttribute('data-dashboard-target');
      if (!target) {
        return;
      }

      const routeMap = {
        accounts: '/dashboard/accounts',
        audits: '/dashboard/audits',
        subscription: '/dashboard/accounts',
        privacy: '/dashboard/privacy',
        profile: '/dashboard/profile'
      };

      window.location.assign(routeMap[target] || '/dashboard/accounts');
    });
  });
}

window.HubSpotAuditUI = {
  API_BASE_URL,
  TOKEN_STORAGE,
  CLIENT_KEY_STORAGE,
  PORTAL_ID_STORAGE,
  AI_PROMPT_MODE_STORAGE,
  AI_PENDING_JOB_STORAGE,
  APP_DATA_CHANGE_STORAGE,
  APP_LOADING_CLASS,
  $,
  apiFetch,
  escapeHtml,
  broadcastDataChange,
  onDataChange,
  setAppReady,
  setAppLoading,
  initSidebarToggle,
  setSidebarCollapsed,
  getSidebarCollapsed
};

window.addEventListener('DOMContentLoaded', () => {
  initStaticIcons();
  initSidebarToggle();
  initDashboardNavigation();
});
