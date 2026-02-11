/**
 * SIGN BOT - Metrics & Analytics
 */

let metricsCharts = {};
let lastMetricsHash = null;

/**
 * Initialize default date range (last 30 days)
 */
function initDateRange() {
  const fromEl = document.getElementById('metricsDateFrom');
  const toEl = document.getElementById('metricsDateTo');

  if (fromEl && !fromEl.value) {
    const from = new Date();
    from.setDate(from.getDate() - 30);
    fromEl.value = from.toISOString().split('T')[0];
  }
  if (toEl && !toEl.value) {
    toEl.value = new Date().toISOString().split('T')[0];
  }
}

/**
 * Load all metrics
 */
async function loadAll() {
  const container = document.getElementById('metricsContainer');
  if (!container) {
    return;
  }

  initDateRange();

  try {
    const data = await window.API.getDocumentStats();
    if (!data.success) {
      throw new Error(data.error || 'Error cargando metricas');
    }

    // Hash comparison
    const newHash = window.Utils.simpleHash(JSON.stringify(data));
    if (newHash === lastMetricsHash) {
      return;
    }
    lastMetricsHash = newHash;

    const charts = data.charts || {};
    const stats = data.stats || {};

    container.innerHTML = renderMetricsGrid();
    initMetricsCharts(charts, stats);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h2>Error</h2><p>${err.message}</p></div>`;
  }
}

/**
 * Render metrics chart grid
 */
function renderMetricsGrid() {
  return (
    '<div class="metrics-grid">' +
    // Signing rate over time
    '<div class="chart-box full-width">' +
    '<div class="chart-box-header"><h3>Tasa de Firma en el Tiempo</h3></div>' +
    '<div class="chart-canvas-container"><canvas id="metricsSigningRate"></canvas></div>' +
    '</div>' +
    // Documents by status
    '<div class="chart-box">' +
    '<div class="chart-box-header"><h3>Documentos por Estado</h3></div>' +
    '<div class="chart-canvas-container"><canvas id="metricsStatusDoughnut"></canvas></div>' +
    '</div>' +
    // Documents by type
    '<div class="chart-box">' +
    '<div class="chart-box-header"><h3>Documentos por Tipo</h3></div>' +
    '<div class="chart-canvas-container"><canvas id="metricsTypeDoughnut"></canvas></div>' +
    '</div>' +
    // Rejection reasons
    '<div class="chart-box">' +
    '<div class="chart-box-header"><h3>Motivos de Rechazo</h3></div>' +
    '<div class="chart-canvas-container"><canvas id="metricsRejectionReasons"></canvas></div>' +
    '</div>' +
    // Average reminders
    '<div class="chart-box">' +
    '<div class="chart-box-header"><h3>Recordatorios Promedio por Documento</h3></div>' +
    '<div class="chart-canvas-container"><canvas id="metricsReminders"></canvas></div>' +
    '</div>' +
    // Time to sign distribution
    '<div class="chart-box full-width">' +
    '<div class="chart-box-header"><h3>Distribucion del Tiempo para Firmar</h3></div>' +
    '<div class="chart-canvas-container"><canvas id="metricsTimeDistribution"></canvas></div>' +
    '</div>' +
    '</div>'
  );
}

/**
 * Initialize all metrics charts
 */
function initMetricsCharts(charts, stats) {
  // Destroy existing charts
  Object.values(metricsCharts).forEach((chart) => chart.destroy());
  metricsCharts = {};

  const chartColors = {
    PENDIENTE_ENVIO: '#F59E0B',
    ENVIADO: '#3B82F6',
    ENTREGADO: '#06B6D4',
    VISTO: '#8B5CF6',
    FIRMADO: '#10B981',
    RECHAZADO: '#EF4444',
    ANULADO: '#6B7280',
    ERROR: '#F97316',
  };

  // 1. Signing rate over time (line chart)
  const signingCtx = document.getElementById('metricsSigningRate');
  if (signingCtx && charts.tendencia7dias && charts.tendencia7dias.length > 0) {
    const labels = charts.tendencia7dias.map((d) => {
      const date = new Date(d.Fecha);
      return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
    });
    const rates = charts.tendencia7dias.map((d) => {
      const total = d.Total || 1;
      const firmados = d.Firmados || 0;
      return ((firmados / total) * 100).toFixed(1);
    });

    metricsCharts.signingRate = new Chart(signingCtx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Tasa de Firma (%)',
            data: rates,
            borderColor: '#4F46E5',
            backgroundColor: 'rgba(79, 70, 229, 0.08)',
            fill: true,
            tension: 0.4,
            pointBackgroundColor: '#fff',
            pointBorderColor: '#4F46E5',
            pointBorderWidth: 2,
            pointRadius: 5,
            pointHoverRadius: 7,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0F172A',
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: function (context) {
                return `Tasa: ${context.parsed.y}%`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#64748B' } },
          y: {
            beginAtZero: true,
            max: 100,
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { font: { size: 11 }, color: '#94A3B8', callback: (v) => `${v}%` },
          },
        },
      },
    });
  }

  // 2. Documents by status (doughnut)
  const statusCtx = document.getElementById('metricsStatusDoughnut');
  if (statusCtx && charts.porEstado && charts.porEstado.length > 0) {
    metricsCharts.status = new Chart(statusCtx, {
      type: 'doughnut',
      data: {
        labels: charts.porEstado.map((d) => window.Utils.formatDocumentState(d.Estado).label),
        datasets: [
          {
            data: charts.porEstado.map((d) => d.Total),
            backgroundColor: charts.porEstado.map((d) => chartColors[d.Estado] || '#94A3B8'),
            borderWidth: 0,
            spacing: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 10,
              usePointStyle: true,
              pointStyle: 'circle',
              font: { size: 10, weight: '500' },
            },
          },
          tooltip: { backgroundColor: '#0F172A', padding: 10, cornerRadius: 8 },
        },
      },
    });
  }

  // 3. Documents by type (doughnut)
  const typeCtx = document.getElementById('metricsTypeDoughnut');
  if (typeCtx && charts.porTipo && charts.porTipo.length > 0) {
    const typeColors = [
      '#4F46E5',
      '#10B981',
      '#F59E0B',
      '#EF4444',
      '#8B5CF6',
      '#06B6D4',
      '#F97316',
      '#6B7280',
    ];

    metricsCharts.type = new Chart(typeCtx, {
      type: 'doughnut',
      data: {
        labels: charts.porTipo.map((d) => window.Utils.formatDocumentType(d.Tipo)),
        datasets: [
          {
            data: charts.porTipo.map((d) => d.Total),
            backgroundColor: typeColors.slice(0, charts.porTipo.length),
            borderWidth: 0,
            spacing: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 10,
              usePointStyle: true,
              pointStyle: 'circle',
              font: { size: 10, weight: '500' },
            },
          },
          tooltip: { backgroundColor: '#0F172A', padding: 10, cornerRadius: 8 },
        },
      },
    });
  }

  // 4. Rejection reasons (horizontal bar)
  const rejectionCtx = document.getElementById('metricsRejectionReasons');
  if (rejectionCtx && charts.motivosRechazo && charts.motivosRechazo.length > 0) {
    metricsCharts.rejection = new Chart(rejectionCtx, {
      type: 'bar',
      data: {
        labels: charts.motivosRechazo.map((d) => d.Motivo || 'Sin especificar'),
        datasets: [
          {
            label: 'Rechazos',
            data: charts.motivosRechazo.map((d) => d.Total),
            backgroundColor: '#EF4444',
            borderRadius: 6,
            barPercentage: 0.6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: '#0F172A', padding: 10, cornerRadius: 8 },
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { font: { size: 11 }, color: '#94A3B8', stepSize: 1 },
          },
          y: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#64748B' } },
        },
      },
    });
  } else if (rejectionCtx) {
    metricsCharts.rejection = new Chart(rejectionCtx, {
      type: 'bar',
      data: { labels: ['Sin datos'], datasets: [{ data: [0], backgroundColor: '#E5E7EB' }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { display: false }, y: { display: false } },
      },
    });
  }

  // 5. Average reminders (bar)
  const remindersCtx = document.getElementById('metricsReminders');
  if (remindersCtx && charts.recordatoriosPorTipo && charts.recordatoriosPorTipo.length > 0) {
    metricsCharts.reminders = new Chart(remindersCtx, {
      type: 'bar',
      data: {
        labels: charts.recordatoriosPorTipo.map((d) => window.Utils.formatDocumentType(d.Tipo)),
        datasets: [
          {
            label: 'Recordatorios Promedio',
            data: charts.recordatoriosPorTipo.map((d) => d.Promedio || 0),
            backgroundColor: '#8B5CF6',
            borderRadius: 6,
            barPercentage: 0.6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: '#0F172A', padding: 10, cornerRadius: 8 },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#64748B' } },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { font: { size: 11 }, color: '#94A3B8', stepSize: 1 },
          },
        },
      },
    });
  } else if (remindersCtx) {
    metricsCharts.reminders = new Chart(remindersCtx, {
      type: 'bar',
      data: { labels: ['Sin datos'], datasets: [{ data: [0], backgroundColor: '#E5E7EB' }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { display: false }, y: { display: false } },
      },
    });
  }

  // 6. Time to sign distribution (histogram-style bar)
  const timeCtx = document.getElementById('metricsTimeDistribution');
  if (timeCtx && charts.distribucionTiempo && charts.distribucionTiempo.length > 0) {
    metricsCharts.time = new Chart(timeCtx, {
      type: 'bar',
      data: {
        labels: charts.distribucionTiempo.map((d) => d.Rango),
        datasets: [
          {
            label: 'Documentos',
            data: charts.distribucionTiempo.map((d) => d.Total),
            backgroundColor: '#4F46E5',
            borderRadius: 4,
            barPercentage: 0.85,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: '#0F172A', padding: 12, cornerRadius: 8 },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#64748B' } },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { font: { size: 11 }, color: '#94A3B8', stepSize: 1 },
          },
        },
      },
    });
  } else if (timeCtx) {
    metricsCharts.time = new Chart(timeCtx, {
      type: 'bar',
      data: {
        labels: ['< 1h', '1-4h', '4-12h', '12-24h', '24-48h', '> 48h'],
        datasets: [{ data: [0, 0, 0, 0, 0, 0], backgroundColor: '#E0E7FF' }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#64748B' } },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { font: { size: 11 }, color: '#94A3B8' },
          },
        },
      },
    });
  }
}

// Export for use in other modules
window.Metrics = {
  loadAll,
  initDateRange,
};
