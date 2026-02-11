/**
 * SIGN BOT - Conversations & Chat
 */

let currentPhone = null;
let currentSession = null;
let autoRefreshChat = null;
let lastMessageCount = 0;
let lastChatDataHash = null;
let lastConversationsHash = null;
let isFirstLoad = true;

/**
 * Load conversations list
 */
async function loadList() {
  const list = document.getElementById('conversationsList');
  if (!list) {
    return;
  }

  try {
    const data = await window.API.getConversations();
    if (!data.conversations || data.conversations.length === 0) {
      list.innerHTML = '<div class="loading">No hay conversaciones activas</div>';
      lastConversationsHash = null;
      return;
    }

    // Hash comparison to avoid unnecessary re-render
    const newHash = window.Utils.simpleHash(JSON.stringify(data.conversations));
    if (newHash === lastConversationsHash) {
      return;
    }
    lastConversationsHash = newHash;

    list.innerHTML = data.conversations
      .map((conv) => {
        const isAgent = conv.Estado === 'AGENTE_ACTIVO';
        const isFinalizado = conv.Estado && conv.Estado.indexOf('FINALIZADO') > -1;
        const statusClass = isAgent ? 'agente' : isFinalizado ? 'finalizado' : 'activo';
        const statusText = isAgent ? 'Agente' : isFinalizado ? 'Finalizado' : 'Activo';
        const displayName = conv.NombreUsuario || window.Utils.maskPhone(conv.Telefono);
        const initial = conv.NombreUsuario ? conv.NombreUsuario.charAt(0).toUpperCase() : 'U';

        return (
          `<div class="conversation-item ${currentPhone === conv.Telefono ? 'active' : ''}" onclick="Conversations.loadChat('${conv.Telefono}')">` +
          `<div class="avatar ${isAgent ? 'agent' : ''}">${initial}</div>` +
          `<div class="conv-info">` +
          `<div class="conv-header">` +
          `<span class="conv-name">${displayName}</span>` +
          `<span class="conv-time">${window.Utils.formatDate(conv.FechaUltimoMensaje)}</span>` +
          `</div>` +
          `<div class="conv-preview">` +
          `<span>${conv.NombreUsuario || 'Cliente'} \u2022 ${conv.TotalMensajes || 0} msgs</span>` +
          `<span class="status ${statusClass}">${statusText}</span>` +
          `</div>` +
          `</div>` +
          `</div>`
        );
      })
      .join('');
  } catch (err) {
    list.innerHTML = '<div class="loading">Error al cargar conversaciones</div>';
  }
}

/**
 * Load chat for a specific phone number
 */
async function loadChat(phone) {
  // Capture scroll position BEFORE making changes
  const oldMsgs = document.getElementById('messagesContainer');
  const oldScrollTop = oldMsgs ? oldMsgs.scrollTop : 0;
  const oldScrollHeight = oldMsgs ? oldMsgs.scrollHeight : 0;
  const oldClientHeight = oldMsgs ? oldMsgs.clientHeight : 0;
  const wasAtBottom = !oldMsgs || oldScrollHeight - oldScrollTop - oldClientHeight < 100;

  // Reset tracking if changing conversation
  if (currentPhone !== phone) {
    isFirstLoad = true;
    lastChatDataHash = null;
    lastConversationsHash = null;
  }

  currentPhone = phone;
  const chatArea = document.getElementById('chatArea');
  if (!chatArea) {
    return;
  }

  chatArea.classList.add('active');
  document.getElementById('sidebar').classList.add('hidden');

  try {
    const data = await window.API.getChat(phone);

    // Hash comparison to avoid flickering
    const newChatHash = window.Utils.simpleHash(JSON.stringify(data));

    if (!isFirstLoad && newChatHash === lastChatDataHash) {
      // No changes - just schedule next refresh
      if (autoRefreshChat) {
        clearInterval(autoRefreshChat);
      }
      autoRefreshChat = setInterval(() => {
        if (currentPhone === phone) {
          loadChat(phone);
        }
      }, window.CONFIG.REFRESH_INTERVAL_CHAT);
      return;
    }
    lastChatDataHash = newChatHash;

    const messages = data.messages || [];
    const currentMsgCount = messages.length;

    currentSession = data.session;
    const session = data.session || {};
    const isAgentMode = session.Estado === 'AGENTE_ACTIVO';
    const displayName = session.NombreUsuario || window.Utils.maskPhone(phone);
    const userInitial = session.NombreUsuario ? session.NombreUsuario.charAt(0).toUpperCase() : 'U';

    let html =
      `<div class="chat-header">` +
      `<button class="back-btn" onclick="Navigation.showSidebar()"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg></button>` +
      `<div class="avatar ${isAgentMode ? 'agent' : ''}">${userInitial}</div>` +
      `<div class="chat-header-info"><h2>${displayName}</h2><span>${window.Utils.maskPhone(phone)}</span></div>` +
      `<div class="chat-header-actions">${
        !isAgentMode
          ? '<button class="btn btn-primary" onclick="Conversations.takeover()">Tomar control</button>'
          : ''
      }${
        isAgentMode
          ? '<button class="btn btn-danger" onclick="Conversations.release()">Devolver al Bot</button>'
          : ''
      }</div></div>`;

    if (isAgentMode) {
      html += `<div class="agent-banner"><span>Controlada por: ${session.AgenteNombre || 'Admin'}</span><span>Desde ${window.Utils.formatFullDate(session.FechaTomaAgente)}</span></div>`;
    }

    html += '<div class="messages" id="messagesContainer">';
    let lastDate = null;

    messages.forEach((msg) => {
      const msgDate = new Date(msg.FechaCreacion).toDateString();
      if (msgDate !== lastDate) {
        html += `<div class="date-separator"><span>${new Date(msg.FechaCreacion).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>`;
        lastDate = msgDate;
      }

      const isUser = msg.Tipo === 'U';
      const isAgentMsg = msg.AgenteId != null;
      const msgClass = isUser ? 'user' : isAgentMsg ? 'agent' : 'bot';
      const sender = isUser
        ? session.NombreUsuario || 'Cliente'
        : isAgentMsg
          ? msg.AgenteNombre || 'Admin'
          : 'Sign Bot';
      const contenido = msg.Contenido || '';

      // Sign Bot is text-only: render as text
      const contentHtml = isUser
        ? window.Utils.escapeHtml(contenido).replace(/\n/g, '<br>')
        : window.Utils.renderMarkdown(contenido);

      html +=
        `<div class="message ${msgClass}">` +
        `<div class="message-sender">${sender}</div>` +
        `<div class="message-content">${contentHtml}</div>` +
        `<div class="message-time">${window.Utils.formatFullDate(msg.FechaCreacion)}</div>` +
        `</div>`;
    });

    html += '</div>';
    html +=
      `<div class="input-area">` +
      `<input type="text" id="messageInput" placeholder="${isAgentMode ? 'Escribe un mensaje...' : 'Toma el control para responder'}" ${!isAgentMode ? 'disabled' : ''} onkeypress="if(event.key==='Enter')Conversations.sendMessage()">` +
      `<button class="send-btn" onclick="Conversations.sendMessage()" ${!isAgentMode ? 'disabled' : ''}><svg width="20" height="20" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>` +
      `</div>`;

    const hasNewMessages = currentMsgCount > lastMessageCount;
    const shouldScrollToBottom = isFirstLoad || hasNewMessages || wasAtBottom;

    chatArea.innerHTML = html;
    const msgs = document.getElementById('messagesContainer');

    if (msgs) {
      if (shouldScrollToBottom) {
        msgs.scrollTop = msgs.scrollHeight;
      } else {
        msgs.scrollTop = oldScrollTop;
      }
    }

    lastMessageCount = currentMsgCount;
    isFirstLoad = false;
    loadList();

    if (autoRefreshChat) {
      clearInterval(autoRefreshChat);
    }
    autoRefreshChat = setInterval(() => {
      if (currentPhone === phone) {
        loadChat(phone);
      }
    }, window.CONFIG.REFRESH_INTERVAL_CHAT);
  } catch (err) {
    chatArea.innerHTML = `<div class="empty-state"><h2>Error</h2><p>${err.message}</p></div>`;
  }
}

/**
 * Takeover conversation (agent takes control)
 */
async function takeover() {
  if (!currentPhone) {
    return;
  }
  try {
    const agent = window.Auth.getAgentInfo();
    const data = await window.API.takeoverConversation(currentPhone, agent.id, agent.name);
    if (data.success) {
      loadChat(currentPhone);
    } else {
      alert(`Error: ${data.error || 'No se pudo tomar el control'}`);
    }
  } catch (err) {
    alert('Error de conexion');
  }
}

/**
 * Release conversation back to bot
 */
async function release() {
  if (!currentPhone || !confirm('\u00bfDevolver esta conversaci\u00f3n al bot?')) {
    return;
  }
  try {
    const data = await window.API.releaseConversation(currentPhone);
    if (data.success) {
      loadChat(currentPhone);
    } else {
      alert(`Error: ${data.error || 'No se pudo liberar'}`);
    }
  } catch (err) {
    alert('Error de conexion');
  }
}

/**
 * Send message as agent
 */
async function sendMessage() {
  const input = document.getElementById('messageInput');
  const mensaje = input.value.trim();
  if (!mensaje || !currentPhone) {
    return;
  }

  input.disabled = true;
  try {
    const agent = window.Auth.getAgentInfo();
    const data = await window.API.sendAgentMessage(currentPhone, mensaje, agent.id, agent.name);
    if (data.success) {
      input.value = '';
      loadChat(currentPhone);
    } else {
      alert(`Error: ${data.error || 'No se pudo enviar'}`);
    }
  } catch (err) {
    alert('Error de conexion');
  } finally {
    input.disabled = false;
    input.focus();
  }
}

/**
 * Handle search
 */
async function handleSearch(event) {
  const query = event.target.value.trim();
  if (query.length === 0) {
    loadList();
    return;
  }
  if (query.length < 3) {
    return;
  }

  const list = document.getElementById('conversationsList');
  try {
    const data = await window.API.searchConversations(query);
    if (!data.results || data.results.length === 0) {
      list.innerHTML = '<div class="loading">No se encontraron resultados</div>';
      return;
    }

    list.innerHTML = data.results
      .map((conv) => {
        const displayName = conv.NombreUsuario || window.Utils.maskPhone(conv.Telefono);
        const initial = conv.NombreUsuario ? conv.NombreUsuario.charAt(0).toUpperCase() : 'U';
        return (
          `<div class="conversation-item" onclick="Conversations.loadChat('${conv.Telefono}')">` +
          `<div class="avatar">${initial}</div>` +
          `<div class="conv-info">` +
          `<div class="conv-header"><span class="conv-name">${displayName}</span><span class="conv-time">${window.Utils.formatDate(conv.FechaUltimoMensaje)}</span></div>` +
          `<div class="conv-preview">${conv.TotalMensajes} mensajes</div>` +
          `</div></div>`
        );
      })
      .join('');
  } catch (err) {
    list.innerHTML = '<div class="loading">Error en busqueda</div>';
  }
}

/**
 * Refresh all data
 */
function refreshAll() {
  const btn = document.getElementById('refreshBtn');
  if (btn) {
    btn.classList.add('spinning');
  }
  loadList();
  if (currentPhone) {
    loadChat(currentPhone);
  }
  setTimeout(() => {
    if (btn) {
      btn.classList.remove('spinning');
    }
  }, 500);
}

// Export for use in other modules
window.Conversations = {
  loadList,
  loadChat,
  takeover,
  release,
  sendMessage,
  handleSearch,
  refreshAll,
};
