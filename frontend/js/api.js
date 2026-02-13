/**
 * SIGN BOT - API Functions
 */

/**
 * Fetch wrapper with error handling
 */
async function apiFetch(endpoint, options = {}) {
  const url = window.CONFIG.API_BASE + endpoint;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Include Azure Function Key if configured (required for authLevel: function)
  if (window.CONFIG.FUNCTIONS_KEY) {
    headers['x-functions-key'] = window.CONFIG.FUNCTIONS_KEY;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

/**
 * Get document stats (dashboard KPIs)
 */
async function getDocumentStats() {
  return apiFetch('/admin/stats');
}

/**
 * Get documents list with filters
 */
async function getDocuments(filters = {}) {
  const params = new URLSearchParams();
  if (filters.estado) {
    params.append('estado', filters.estado);
  }
  if (filters.tipo) {
    params.append('tipo', filters.tipo);
  }
  if (filters.search) {
    params.append('search', filters.search);
  }
  if (filters.page) {
    params.append('page', filters.page);
  }
  if (filters.pageSize) {
    params.append('pageSize', filters.pageSize);
  }
  if (filters.desde) {
    params.append('desde', filters.desde);
  }
  if (filters.hasta) {
    params.append('hasta', filters.hasta);
  }
  const queryString = params.toString();
  return apiFetch(`/admin/documents${queryString ? `?${queryString}` : ''}`);
}

/**
 * Get document detail by ID
 */
async function getDocumentDetail(id) {
  return apiFetch(`/admin/documents/${encodeURIComponent(id)}`);
}

/**
 * Get conversations list
 */
async function getConversations() {
  return apiFetch('/conversations/list');
}

/**
 * Get chat history for a phone number
 */
async function getChat(phone) {
  return apiFetch(`/conversations/chat/${encodeURIComponent(phone)}`);
}

/**
 * Search conversations
 */
async function searchConversations(query) {
  return apiFetch(`/conversations/search/${encodeURIComponent(query)}`);
}

/**
 * Takeover a conversation (agent takes control)
 */
async function takeoverConversation(phone, agentId, agentName) {
  return apiFetch(`/conversations/takeover/${encodeURIComponent(phone)}`, {
    method: 'POST',
    body: JSON.stringify({ agenteId: agentId, agenteNombre: agentName }),
  });
}

/**
 * Release conversation back to bot
 */
async function releaseConversation(phone) {
  return apiFetch(`/conversations/release/${encodeURIComponent(phone)}`, {
    method: 'POST',
  });
}

/**
 * Send message as agent
 */
async function sendAgentMessage(phone, message, agentId, agentName) {
  return apiFetch(`/conversations/send/${encodeURIComponent(phone)}`, {
    method: 'POST',
    body: JSON.stringify({ mensaje: message, agenteId: agentId, agenteNombre: agentName }),
  });
}

/**
 * Get system health
 */
async function getSystemHealth() {
  return apiFetch('/health');
}

// Export for use in other modules
window.API = {
  fetch: apiFetch,
  getDocumentStats,
  getDocuments,
  getDocumentDetail,
  getConversations,
  getChat,
  searchConversations,
  takeoverConversation,
  releaseConversation,
  sendAgentMessage,
  getSystemHealth,
};
