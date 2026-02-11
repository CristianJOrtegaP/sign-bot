/**
 * SIGN BOT - Utility Functions
 */

/**
 * Format date to relative time or date string
 */
function formatDate(dateStr) {
  if (!dateStr) {
    return '';
  }
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;
  if (diff < 86400000 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 172800000) {
    return 'Ayer';
  }
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' });
}

/**
 * Format date with full timestamp
 */
function formatFullDate(dateStr) {
  if (!dateStr) {
    return '';
  }
  return new Date(dateStr).toLocaleString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
  });
}

/**
 * Format date with full detail (for timelines)
 */
function formatDetailDate(dateStr) {
  if (!dateStr) {
    return '';
  }
  return new Date(dateStr).toLocaleString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Mask phone number for privacy
 */
function maskPhone(phone) {
  if (!phone) {
    return 'Usuario';
  }
  const clean = phone.replace(/[^0-9]/g, '');
  if (clean.length >= 4) {
    return `*** *** ${clean.slice(-4)}`;
  }
  return '****';
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) {
    return '';
  }
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Convert simple markdown to HTML
 */
function renderMarkdown(text) {
  if (!text) {
    return '';
  }
  // Escape HTML first for security
  let html = escapeHtml(text);
  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  // Italic: *text* or _text_
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');
  // Inline code: `code`
  html = html.replace(
    /`([^`]+)`/g,
    '<code style="background:rgba(0,0,0,0.2);padding:2px 6px;border-radius:4px;font-family:monospace;font-size:12px;">$1</code>'
  );
  // Bullet lists: lines starting with - or bullet
  html = html.replace(
    /^[-\u2022]\s+(.+)$/gm,
    '<li style="margin-left:16px;list-style:disc inside;">$1</li>'
  );
  // Numbered lists: lines starting with number.
  html = html.replace(
    /^(\d+)\.\s+(.+)$/gm,
    '<li style="margin-left:16px;list-style:decimal inside;">$2</li>'
  );
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  // Clean redundant <br> after </li>
  html = html.replace(/<\/li><br>/g, '</li>');
  return html;
}

/**
 * Simple hash function for data comparison (avoid unnecessary re-renders)
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash;
}

/**
 * Format document state with emoji, label, and CSS class
 */
function formatDocumentState(estado) {
  const states = {
    PENDIENTE_ENVIO: {
      emoji: '\u23F3',
      label: 'Pendiente de Envio',
      cssClass: 'status-pendiente-envio',
    },
    ENVIADO: { emoji: '\uD83D\uDCE8', label: 'Enviado', cssClass: 'status-enviado' },
    ENTREGADO: { emoji: '\uD83D\uDCEC', label: 'Entregado', cssClass: 'status-entregado' },
    VISTO: { emoji: '\uD83D\uDC41\uFE0F', label: 'Visto', cssClass: 'status-visto' },
    FIRMADO: { emoji: '\u2705', label: 'Firmado', cssClass: 'status-firmado' },
    RECHAZADO: { emoji: '\u274C', label: 'Rechazado', cssClass: 'status-rechazado' },
    ANULADO: { emoji: '\uD83D\uDEAB', label: 'Anulado', cssClass: 'status-anulado' },
    ERROR: { emoji: '\u26A0\uFE0F', label: 'Error', cssClass: 'status-error' },
  };
  return (
    states[estado] || { emoji: '\u2753', label: estado || 'Desconocido', cssClass: 'status-error' }
  );
}

/**
 * Format document type with label
 */
function formatDocumentType(tipo) {
  const types = {
    CONTRATO: 'Contrato',
    ADENDUM: 'Adendum',
    NDA: 'NDA',
    PODER: 'Poder Notarial',
    ACUERDO: 'Acuerdo',
    CONVENIO: 'Convenio',
    CARTA_RESPONSIVA: 'Carta Responsiva',
    OTRO: 'Otro',
  };
  return types[tipo] || tipo || 'Sin tipo';
}

/**
 * Format number with thousands separator
 */
function formatNumber(num) {
  if (num == null || isNaN(num)) {
    return '0';
  }
  return Number(num).toLocaleString('es-MX');
}

/**
 * Format percentage
 */
function formatPercent(num) {
  if (num == null || isNaN(num)) {
    return '0%';
  }
  return `${Number(num).toFixed(1)}%`;
}

/**
 * Format hours
 */
function formatHours(num) {
  if (num == null || isNaN(num)) {
    return '0h';
  }
  if (num < 1) {
    return `${Math.round(num * 60)}min`;
  }
  return `${Number(num).toFixed(1)}h`;
}

// Export for use in other modules
window.Utils = {
  formatDate,
  formatFullDate,
  formatDetailDate,
  maskPhone,
  escapeHtml,
  renderMarkdown,
  simpleHash,
  formatDocumentState,
  formatDocumentType,
  formatNumber,
  formatPercent,
  formatHours,
};
