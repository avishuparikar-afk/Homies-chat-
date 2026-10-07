/**
 * Global Frontend Configuration
 * Production-ready: adapts dynamically to current domain, or respects explicit window.__ENV__ / localStorage overrides.
 */
const configuredBackend =
  (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.API_BASE_URL) ||
  (typeof localStorage !== 'undefined' && localStorage.getItem('HOMIES_BACKEND_URL')) ||
  (typeof window !== 'undefined' ? window.location.origin : '');

const CONFIG = {
  API_BASE_URL: configuredBackend,
  SOCKET_URL:
    (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.SOCKET_URL) ||
    configuredBackend,
  HEALTH_ENDPOINT: '/api/health'
};

if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}
