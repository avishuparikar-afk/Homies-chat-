/**
 * Global Frontend Configuration
 * Production-ready: adapts dynamically to current domain, or respects explicit window.__ENV__ overrides.
 */
const CONFIG = {
  API_BASE_URL: (window.__ENV__ && window.__ENV__.API_BASE_URL) || window.location.origin,
  SOCKET_URL: (window.__ENV__ && window.__ENV__.SOCKET_URL) || window.location.origin,
  HEALTH_ENDPOINT: '/api/health'
};

window.CONFIG = CONFIG;
