/**
 * SIGN BOT - Documents Management
 */

const currentFilters = {
  estado: '',
  tipo: '',
  search: '',
  page: 1,
  desde: '',
  hasta: '',
};
let lastDocumentsHash = null;
let searchTimeout = null;

/**
 * Load documents with current filters
 */
async function loadDocuments() {
  const container = document.getElementById('documentsContainer');
  if (!container) {
    return;
  }

  try {
    const data = await window.API.getDocuments({
      ...currentFilters,
      pageSize: window.CONFIG.DOCUMENTS_PAGE_SIZE,
    });

    if (!data.success) {
      throw new Error(data.error || 'Error cargando documentos');
    }

    // Hash comparison to avoid flickering on auto-refresh
    const newHash = window.Utils.simpleHash(JSON.stringify(data));
    if (newHash === lastDocumentsHash) {
      return;
    }
    lastDocumentsHash = newHash;

    const docs = data.documents || [];
    const pagination = data.pagination || {};

    container.innerHTML =
      renderFilterBar() + renderDocumentsTable(docs) + renderPagination(pagination);

    // Restore filter values
    restoreFilterValues();
  } catch (err) {
    container.innerHTML = `${renderFilterBar()}<div class="empty-state"><h2>Error</h2><p>${err.message}</p></div>`;
    restoreFilterValues();
  }
}

/**
 * Render filter bar
 */
function renderFilterBar() {
  return (
    '<div class="filter-bar">' +
    // Estado filter
    '<select class="filter-select" id="filterEstado" onchange="Documents.onFilterChange()">' +
    '<option value="">Todos los estados</option>' +
    '<option value="PENDIENTE_ENVIO">Pendiente de Envio</option>' +
    '<option value="ENVIADO">Enviado</option>' +
    '<option value="ENTREGADO">Entregado</option>' +
    '<option value="VISTO">Visto</option>' +
    '<option value="FIRMADO">Firmado</option>' +
    '<option value="RECHAZADO">Rechazado</option>' +
    '<option value="ANULADO">Anulado</option>' +
    '<option value="ERROR">Error</option>' +
    '</select>' +
    // Tipo filter
    '<select class="filter-select" id="filterTipo" onchange="Documents.onFilterChange()">' +
    '<option value="">Todos los tipos</option>' +
    '<option value="CONTRATO">Contrato</option>' +
    '<option value="ADENDUM">Adendum</option>' +
    '<option value="NDA">NDA</option>' +
    '<option value="PODER">Poder Notarial</option>' +
    '<option value="ACUERDO">Acuerdo</option>' +
    '<option value="CONVENIO">Convenio</option>' +
    '<option value="CARTA_RESPONSIVA">Carta Responsiva</option>' +
    '<option value="OTRO">Otro</option>' +
    '</select>' +
    // Search
    '<input type="text" class="filter-input" id="filterSearch" placeholder="Buscar por cliente, documento..." onkeyup="Documents.onSearchInput(event)">' +
    // Date range
    '<input type="date" class="filter-date" id="filterDesde" onchange="Documents.onFilterChange()" title="Desde">' +
    '<input type="date" class="filter-date" id="filterHasta" onchange="Documents.onFilterChange()" title="Hasta">' +
    '</div>'
  );
}

/**
 * Restore filter values after re-render
 */
function restoreFilterValues() {
  const estadoEl = document.getElementById('filterEstado');
  const tipoEl = document.getElementById('filterTipo');
  const searchEl = document.getElementById('filterSearch');
  const desdeEl = document.getElementById('filterDesde');
  const hastaEl = document.getElementById('filterHasta');

  if (estadoEl) {
    estadoEl.value = currentFilters.estado;
  }
  if (tipoEl) {
    tipoEl.value = currentFilters.tipo;
  }
  if (searchEl) {
    searchEl.value = currentFilters.search;
  }
  if (desdeEl) {
    desdeEl.value = currentFilters.desde;
  }
  if (hastaEl) {
    hastaEl.value = currentFilters.hasta;
  }
}

/**
 * Handle filter dropdown change
 */
function onFilterChange() {
  const estadoEl = document.getElementById('filterEstado');
  const tipoEl = document.getElementById('filterTipo');
  const desdeEl = document.getElementById('filterDesde');
  const hastaEl = document.getElementById('filterHasta');

  currentFilters.estado = estadoEl ? estadoEl.value : '';
  currentFilters.tipo = tipoEl ? tipoEl.value : '';
  currentFilters.desde = desdeEl ? desdeEl.value : '';
  currentFilters.hasta = hastaEl ? hastaEl.value : '';
  currentFilters.page = 1;
  lastDocumentsHash = null;
  loadDocuments();
}

/**
 * Handle search input with debounce
 */
function onSearchInput(event) {
  const query = event.target.value.trim();
  currentFilters.search = query;

  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }

  searchTimeout = setTimeout(() => {
    currentFilters.page = 1;
    lastDocumentsHash = null;
    loadDocuments();
  }, 400);
}

/**
 * Render documents table
 */
function renderDocumentsTable(docs) {
  if (!docs || docs.length === 0) {
    return (
      '<div class="empty-state" style="padding: 40px;">' +
      '<h2 style="font-size: 20px;">Sin documentos</h2>' +
      '<p>No se encontraron documentos con los filtros seleccionados</p>' +
      '</div>'
    );
  }

  let rows = '';
  docs.forEach((doc) => {
    const state = window.Utils.formatDocumentState(doc.Estado);
    const tipo = window.Utils.formatDocumentType(doc.TipoDocumento);
    const docId = doc.Id || doc.id || '';
    const shortId = docId.length > 10 ? `${docId.substring(0, 10)}...` : docId;

    rows +=
      `<tr class="doc-row" onclick="Documents.showDetail('${window.Utils.escapeHtml(docId)}')">` +
      `<td class="doc-id" title="${window.Utils.escapeHtml(docId)}">${shortId}</td>` +
      `<td>${window.Utils.escapeHtml(doc.NombreCliente || '-')}</td>` +
      `<td>${tipo}</td>` +
      `<td><span class="doc-status-badge ${state.cssClass}">${state.emoji} ${state.label}</span></td>` +
      `<td>${window.Utils.escapeHtml(doc.NombreDocumento || '-')}</td>` +
      `<td>${window.Utils.formatFullDate(doc.FechaCreacion)}</td>` +
      `<td>${window.Utils.formatFullDate(doc.FechaActualizacion || doc.FechaCreacion)}</td>` +
      `</tr>`;
  });

  return (
    `<table class="documents-table">` +
    `<thead><tr>` +
    `<th>ID</th>` +
    `<th>Cliente</th>` +
    `<th>Tipo</th>` +
    `<th>Estado</th>` +
    `<th>Documento</th>` +
    `<th>Creado</th>` +
    `<th>Actualizado</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table>`
  );
}

/**
 * Render pagination
 */
function renderPagination(pagination) {
  const totalPages = pagination.totalPages || 1;
  const currentPage = pagination.page || currentFilters.page;
  const total = pagination.total || 0;

  if (totalPages <= 1) {
    return `<div class="pagination"><span class="pagination-info">${total} documento(s)</span></div>`;
  }

  let buttons = '';

  // Previous button
  buttons += `<button ${currentPage <= 1 ? 'disabled' : ''} onclick="Documents.goToPage(${currentPage - 1})">&laquo; Anterior</button>`;

  // Page numbers
  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, currentPage + 2);

  if (startPage > 1) {
    buttons += `<button onclick="Documents.goToPage(1)">1</button>`;
    if (startPage > 2) {
      buttons += `<span class="pagination-info">...</span>`;
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    buttons += `<button class="${i === currentPage ? 'active' : ''}" onclick="Documents.goToPage(${i})">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      buttons += `<span class="pagination-info">...</span>`;
    }
    buttons += `<button onclick="Documents.goToPage(${totalPages})">${totalPages}</button>`;
  }

  // Next button
  buttons += `<button ${currentPage >= totalPages ? 'disabled' : ''} onclick="Documents.goToPage(${currentPage + 1})">Siguiente &raquo;</button>`;

  return (
    `<div class="pagination">${buttons}<span class="pagination-info">${total} documento(s)</span>` +
    `</div>`
  );
}

/**
 * Go to specific page
 */
function goToPage(page) {
  currentFilters.page = page;
  lastDocumentsHash = null;
  loadDocuments();
}

/**
 * Show document detail modal
 */
async function showDetail(docId) {
  const modal = document.getElementById('docDetailModal');
  if (!modal) {
    return;
  }

  modal.innerHTML =
    '<div class="doc-detail-overlay" onclick="Documents.closeDetail(event)">' +
    '<div class="doc-detail-panel">' +
    '<div class="doc-detail-header">' +
    '<h2>Cargando...</h2>' +
    '<button class="doc-detail-close" onclick="Documents.closeDetail(event)">&times;</button>' +
    '</div>' +
    '<div class="doc-detail-body"><div class="loading"><div class="loading-spinner"></div>Cargando detalle...</div></div>' +
    '</div></div>';

  try {
    const data = await window.API.getDocumentDetail(docId);
    if (!data.success) {
      throw new Error(data.error || 'Error cargando detalle');
    }

    const doc = data.document || {};
    const state = window.Utils.formatDocumentState(doc.Estado);
    const tipo = window.Utils.formatDocumentType(doc.TipoDocumento);
    const timeline = data.timeline || [];

    let timelineHtml = '';
    if (timeline.length > 0) {
      timelineHtml = '<div class="doc-timeline"><h3>Historial de Cambios</h3>';
      timeline.forEach((entry) => {
        const entryState = window.Utils.formatDocumentState(entry.Estado);
        timelineHtml +=
          '<div class="timeline-item">' +
          `<div><span class="timeline-date">${window.Utils.formatDetailDate(entry.Fecha)}</span></div>` +
          `<div><span class="timeline-text">${entryState.emoji} ${entryState.label}</span></div>` +
          '</div>';
      });
      timelineHtml += '</div>';
    }

    const signingUrl = doc.UrlFirma
      ? `<a href="${window.Utils.escapeHtml(doc.UrlFirma)}" target="_blank" rel="noopener">Abrir enlace de firma</a>`
      : '<span style="color: var(--text-muted);">No disponible</span>';

    modal.innerHTML =
      `<div class="doc-detail-overlay" onclick="Documents.closeDetail(event)">` +
      `<div class="doc-detail-panel" onclick="event.stopPropagation()">` +
      `<div class="doc-detail-header">` +
      `<h2>${state.emoji} Detalle del Documento</h2>` +
      `<button class="doc-detail-close" onclick="Documents.closeDetail(event)">&times;</button>` +
      `</div>` +
      `<div class="doc-detail-body">` +
      `<div class="doc-detail-grid">` +
      `<div class="doc-detail-field"><label>ID</label><span class="doc-id">${window.Utils.escapeHtml(doc.Id || doc.id || '-')}</span></div>` +
      `<div class="doc-detail-field"><label>Estado</label><span class="doc-status-badge ${state.cssClass}">${state.emoji} ${state.label}</span></div>` +
      `<div class="doc-detail-field"><label>Cliente</label><span>${window.Utils.escapeHtml(doc.NombreCliente || '-')}</span></div>` +
      `<div class="doc-detail-field"><label>Telefono</label><span>${window.Utils.escapeHtml(doc.Telefono || '-')}</span></div>` +
      `<div class="doc-detail-field"><label>Tipo</label><span>${tipo}</span></div>` +
      `<div class="doc-detail-field"><label>Documento</label><span>${window.Utils.escapeHtml(doc.NombreDocumento || '-')}</span></div>` +
      `<div class="doc-detail-field"><label>Fecha Creacion</label><span>${window.Utils.formatDetailDate(doc.FechaCreacion)}</span></div>` +
      `<div class="doc-detail-field"><label>Ultima Actualizacion</label><span>${window.Utils.formatDetailDate(doc.FechaActualizacion || doc.FechaCreacion)}</span></div>` +
      `</div>` +
      `<div class="doc-detail-field"><label>Enlace de Firma</label>${signingUrl}</div>${
        doc.MotivoRechazo
          ? `<div class="doc-detail-field"><label>Motivo de Rechazo</label><span style="color: var(--accent-red);">${window.Utils.escapeHtml(doc.MotivoRechazo)}</span></div>`
          : ''
      }${
        doc.Recordatorios != null
          ? `<div class="doc-detail-field"><label>Recordatorios Enviados</label><span>${doc.Recordatorios}</span></div>`
          : ''
      }${timelineHtml}</div>` +
      `</div></div>`;
  } catch (err) {
    modal.innerHTML =
      '<div class="doc-detail-overlay" onclick="Documents.closeDetail(event)">' +
      '<div class="doc-detail-panel" onclick="event.stopPropagation()">' +
      '<div class="doc-detail-header">' +
      '<h2>Error</h2>' +
      '<button class="doc-detail-close" onclick="Documents.closeDetail(event)">&times;</button>' +
      '</div>' +
      `<div class="doc-detail-body"><p>${err.message}</p></div>` +
      '</div></div>';
  }
}

/**
 * Close document detail modal
 */
function closeDetail(event) {
  if (event) {
    event.stopPropagation();
  }
  const modal = document.getElementById('docDetailModal');
  if (modal) {
    modal.innerHTML = '';
  }
}

// Export for use in other modules
window.Documents = {
  loadDocuments,
  onFilterChange,
  onSearchInput,
  goToPage,
  showDetail,
  closeDetail,
};
