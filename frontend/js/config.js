/**
 * AC FIXBOT - Configuration
 */

// API Base URL - points to Azure Function App directly
// (Linked Backend requires Standard SKU, so we use direct URL)
const API_BASE = 'https://func-acfixbot-poc.azurewebsites.net/api/conversations';

// Auto-refresh intervals (in milliseconds)
const REFRESH_INTERVAL_KPIS = 60000; // 60 seconds
const REFRESH_INTERVAL_CONVERSATIONS = 30000; // 30 seconds
const REFRESH_INTERVAL_CHAT = 5000; // 5 seconds

// Export for use in other modules
window.CONFIG = {
  API_BASE,
  REFRESH_INTERVAL_KPIS,
  REFRESH_INTERVAL_CONVERSATIONS,
  REFRESH_INTERVAL_CHAT,
};
