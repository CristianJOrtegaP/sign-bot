/**
 * AC FIXBOT - API Functions
 */

/**
 * Fetch wrapper with error handling
 */
async function apiFetch(endpoint, options = {}) {
  const url = window.CONFIG.API_BASE + endpoint;
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

/**
 * Get KPIs data
 */
async function getKPIs() {
  return apiFetch('/kpis');
}

/**
 * Get conversations list
 */
async function getConversations() {
  return apiFetch('/list');
}

/**
 * Get chat history for a phone number
 */
async function getChat(phone) {
  return apiFetch(`/chat/${encodeURIComponent(phone)}`);
}

/**
 * Search conversations
 */
async function searchConversations(query) {
  return apiFetch(`/search/${encodeURIComponent(query)}`);
}

/**
 * Takeover a conversation (agent takes control)
 */
async function takeoverConversation(phone, agentId, agentName) {
  return apiFetch(`/takeover/${encodeURIComponent(phone)}`, {
    method: 'POST',
    body: JSON.stringify({ agenteId: agentId, agenteNombre: agentName }),
  });
}

/**
 * Release conversation back to bot
 */
async function releaseConversation(phone) {
  return apiFetch(`/release/${encodeURIComponent(phone)}`, {
    method: 'POST',
  });
}

/**
 * Send message as agent
 */
async function sendAgentMessage(phone, message, agentId, agentName) {
  return apiFetch(`/send/${encodeURIComponent(phone)}`, {
    method: 'POST',
    body: JSON.stringify({ mensaje: message, agenteId: agentId, agenteNombre: agentName }),
  });
}

// Export for use in other modules
window.API = {
  fetch: apiFetch,
  getKPIs,
  getConversations,
  getChat,
  searchConversations,
  takeoverConversation,
  releaseConversation,
  sendAgentMessage,
};
