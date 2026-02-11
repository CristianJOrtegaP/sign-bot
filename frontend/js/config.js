/**
 * SIGN BOT - Configuration
 * Configuracion dinamica por ambiente
 */

// Detectar ambiente basado en hostname
function detectEnvironment() {
  const hostname = window.location.hostname;

  if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
    return 'local';
  }
  if (hostname.includes('-dev') || hostname.includes('dev.')) {
    return 'dev';
  }
  if (hostname.includes('-tst') || hostname.includes('test.') || hostname.includes('staging')) {
    return 'tst';
  }
  // Default to production
  return 'prod';
}

// URLs por ambiente
const API_URLS = {
  local: 'http://localhost:7071/api',
  dev: 'https://func-signbot-dev.azurewebsites.net/api',
  tst: 'https://func-signbot-tst.azurewebsites.net/api',
  prod: 'https://func-signbot-prod.azurewebsites.net/api',
};

const ENVIRONMENT = detectEnvironment();
const API_BASE = API_URLS[ENVIRONMENT] || API_URLS.prod;

// Auto-refresh intervals (in milliseconds)
const REFRESH_INTERVAL_KPIS = 60000; // 60 seconds
const REFRESH_INTERVAL_DOCUMENTS = 30000; // 30 seconds
const REFRESH_INTERVAL_CONVERSATIONS = 30000; // 30 seconds
const REFRESH_INTERVAL_CHAT = 5000; // 5 seconds
const REFRESH_INTERVAL_METRICS = 120000; // 2 minutes
const REFRESH_INTERVAL_HEALTH = 60000; // 60 seconds

// Pagination
const DOCUMENTS_PAGE_SIZE = 20;

// Export for use in other modules
window.CONFIG = {
  ENVIRONMENT,
  API_BASE,
  REFRESH_INTERVAL_KPIS,
  REFRESH_INTERVAL_DOCUMENTS,
  REFRESH_INTERVAL_CONVERSATIONS,
  REFRESH_INTERVAL_CHAT,
  REFRESH_INTERVAL_METRICS,
  REFRESH_INTERVAL_HEALTH,
  DOCUMENTS_PAGE_SIZE,
};

console.log(`[Config] Environment: ${ENVIRONMENT}, API: ${API_BASE}`);
