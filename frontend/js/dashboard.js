/**
 * SIGN BOT - Home / Dashboard (KPIs & Charts)
 * Uses Chart.js for professional visualizations
 */

let lastStatsHash = null;
let chartInstances = {};

/**
 * Load document stats
 */
async function loadStats() {
  const container = document.getElementById('kpiContainer');
  if (!container) {
    return;
  }

  try {
    const data = await window.API.getDocumentStats();
    if (!data.success) {
      throw new Error(data.error || 'Error cargando estadisticas');
    }

    // Hash comparison to avoid flickering
    const newHash = window.Utils.simpleHash(JSON.stringify(data));
    if (newHash === lastStatsHash) {
      return;
    }
    lastStatsHash = newHash;

    const stats = data.stats || {};
    const charts = data.charts || {};
    const recentDocs = data.recentDocuments || [];

    // Render HTML structure
    container.innerHTML =
      renderKPICards(stats) + renderChartContainers() + renderRecentActivity(recentDocs);

    // Initialize Chart.js charts
    initCharts(charts);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h2>Error</h2><p>${err.message}</p></div>`;
  }
}

/**
 * Render compact KPI cards for document signing
 */
function renderKPICards(stats) {
  const signingRate = stats.tasaFirma || 0;
  const signingRateClass =
    signingRate >= 80 ? 'accent-green' : signingRate >= 50 ? 'accent-blue' : '';

  return (
    `<div class="kpi-row">` +
    // Total documents
    `<div class="kpi-compact">` +
    `<span class="kpi-compact-label">Total Documentos</span>` +
    `<div class="kpi-compact-value accent-indigo">${window.Utils.formatNumber(stats.totalDocumentos || 0)}</div>` +
    `</div>` +
    // Pending
    `<div class="kpi-compact">` +
    `<span class="kpi-compact-label">Pendientes</span>` +
    `<div class="kpi-compact-value">${window.Utils.formatNumber(stats.pendientes || 0)}</div>` +
    `<span class="kpi-compact-sub">\u23F3 Por firmar</span>` +
    `</div>` +
    // Signed
    `<div class="kpi-compact">` +
    `<span class="kpi-compact-label">Firmados</span>` +
    `<div class="kpi-compact-value accent-green">${window.Utils.formatNumber(stats.firmados || 0)}</div>` +
    `<span class="kpi-compact-sub">\u2705 Completados</span>` +
    `</div>` +
    // Rejected
    `<div class="kpi-compact">` +
    `<span class="kpi-compact-label">Rechazados</span>` +
    `<div class="kpi-compact-value">${window.Utils.formatNumber(stats.rechazados || 0)}</div>` +
    `<span class="kpi-compact-sub">\u274C Devueltos</span>` +
    `</div>` +
    // Signing rate
    `<div class="kpi-compact">` +
    `<span class="kpi-compact-label">Tasa de Firma</span>` +
    `<div class="kpi-compact-value ${signingRateClass}">${window.Utils.formatPercent(signingRate)}</div>` +
    `</div>` +
    // Average time to sign
    `<div class="kpi-compact">` +
    `<span class="kpi-compact-label">Tiempo Promedio</span>` +
    `<div class="kpi-compact-value">${window.Utils.formatHours(stats.tiempoPromedioFirma || 0)}</div>` +
    `<span class="kpi-compact-sub">Para firmar</span>` +
    `</div>` +
    `</div>`
  );
}

/**
 * Render chart containers with canvas elements
 */
function renderChartContainers() {
  return (
    '<div class="charts-row">' +
    '<div class="chart-box">' +
    '<div class="chart-box-header">' +
    '<h3>Tendencia 7 Dias</h3>' +
    '</div>' +
    '<div class="chart-canvas-container"><canvas id="trendChart"></canvas></div>' +
    '</div>' +
    '<div class="chart-box small">' +
    '<div class="chart-box-header">' +
    '<h3>Por Estado</h3>' +
    '</div>' +
    '<div class="chart-canvas-container"><canvas id="statusChart"></canvas></div>' +
    '</div>' +
    '</div>'
  );
}

/**
 * Render recent activity table
 */
function renderRecentActivity(docs) {
  if (!docs || docs.length === 0) {
    return '';
  }

  let rows = '';
  docs.forEach((doc) => {
    const state = window.Utils.formatDocumentState(doc.Estado);
    const tipo = window.Utils.formatDocumentType(doc.TipoDocumento);
    rows +=
      `<tr>` +
      `<td class="doc-id">${doc.Id ? `${doc.Id.substring(0, 8)}...` : '-'}</td>` +
      `<td>${window.Utils.escapeHtml(doc.NombreCliente || '-')}</td>` +
      `<td>${tipo}</td>` +
      `<td><span class="doc-status-badge ${state.cssClass}">${state.emoji} ${state.label}</span></td>` +
      `<td>${window.Utils.formatFullDate(doc.FechaCreacion)}</td>` +
      `</tr>`;
  });

  return (
    `<div class="recent-activity">` +
    `<h3>Actividad Reciente</h3>` +
    `<table class="activity-table">` +
    `<thead><tr>` +
    `<th>ID</th><th>Cliente</th><th>Tipo</th><th>Estado</th><th>Fecha</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table>` +
    `</div>`
  );
}

/**
 * Initialize Chart.js charts
 */
function initCharts(charts) {
  // Destroy existing charts
  Object.values(chartInstances).forEach((chart) => chart.destroy());
  chartInstances = {};

  // 7-day trend line chart
  if (charts.tendencia7dias && charts.tendencia7dias.length > 0) {
    const ctx = document.getElementById('trendChart');
    if (ctx) {
      const labels = charts.tendencia7dias.map((d) => {
        const date = new Date(d.Fecha);
        return date.toLocaleDateString('es-MX', { weekday: 'short' }).toUpperCase();
      });
      const dataFirmados = charts.tendencia7dias.map((d) => d.Firmados || 0);
      const dataTotal = charts.tendencia7dias.map((d) => d.Total || 0);

      chartInstances.trend = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Total',
              data: dataTotal,
              borderColor: '#4F46E5',
              backgroundColor: 'rgba(79, 70, 229, 0.1)',
              fill: true,
              tension: 0.4,
              pointBackgroundColor: '#fff',
              pointBorderColor: '#4F46E5',
              pointBorderWidth: 2,
              pointRadius: 5,
              pointHoverRadius: 7,
            },
            {
              label: 'Firmados',
              data: dataFirmados,
              borderColor: '#10B981',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              fill: true,
              tension: 0.4,
              pointBackgroundColor: '#fff',
              pointBorderColor: '#10B981',
              pointBorderWidth: 2,
              pointRadius: 4,
              pointHoverRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              labels: {
                padding: 12,
                usePointStyle: true,
                pointStyle: 'circle',
                font: { size: 11, weight: '500' },
              },
            },
            tooltip: {
              backgroundColor: '#0F172A',
              padding: 12,
              cornerRadius: 8,
              titleFont: { size: 13, weight: '600' },
              bodyFont: { size: 14, weight: '700' },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { font: { size: 11, weight: '600' }, color: '#64748B' },
            },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(0,0,0,0.05)' },
              ticks: {
                font: { size: 11 },
                color: '#94A3B8',
                stepSize: 1,
              },
            },
          },
        },
      });
    }
  }

  // Status doughnut chart
  if (charts.porEstado && charts.porEstado.length > 0) {
    const ctx = document.getElementById('statusChart');
    if (ctx) {
      const colors = {
        PENDIENTE_ENVIO: '#F59E0B',
        ENVIADO: '#3B82F6',
        ENTREGADO: '#06B6D4',
        VISTO: '#8B5CF6',
        FIRMADO: '#10B981',
        RECHAZADO: '#EF4444',
        ANULADO: '#6B7280',
        ERROR: '#F97316',
      };

      chartInstances.status = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: charts.porEstado.map((d) => {
            const st = window.Utils.formatDocumentState(d.Estado);
            return st.label;
          }),
          datasets: [
            {
              data: charts.porEstado.map((d) => d.Total),
              backgroundColor: charts.porEstado.map((d) => colors[d.Estado] || '#94A3B8'),
              borderWidth: 0,
              spacing: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '65%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                padding: 12,
                usePointStyle: true,
                pointStyle: 'circle',
                font: { size: 11, weight: '500' },
              },
            },
            tooltip: {
              backgroundColor: '#0F172A',
              padding: 10,
              cornerRadius: 8,
            },
          },
        },
      });
    }
  }
}

// Export for use in other modules
window.Dashboard = {
  loadStats,
  renderKPICards,
};
