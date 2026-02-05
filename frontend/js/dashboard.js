/**
 * AC FIXBOT - Dashboard (KPIs & Charts)
 * Uses Chart.js for professional visualizations
 */

let lastKpisHash = null;
let chartInstances = {};

/**
 * Load KPIs data
 */
async function loadKPIs() {
  const container = document.getElementById('kpiContainer');
  if (!container) {
    return;
  }

  try {
    const data = await window.API.getKPIs();
    if (!data.success) {
      throw new Error(data.error || 'Error cargando KPIs');
    }

    // Hash comparison to avoid flickering
    const newHash = window.Utils.simpleHash(JSON.stringify(data));
    if (newHash === lastKpisHash) {
      return;
    }
    lastKpisHash = newHash;

    const kpis = data.kpis;
    const charts = data.charts;

    // Render HTML structure first
    container.innerHTML = renderKPICards(kpis) + renderChartContainers();

    // Then initialize Chart.js charts
    initCharts(charts);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h2>Error</h2><p>${err.message}</p></div>`;
  }
}

/**
 * Render compact KPI cards
 */
function renderKPICards(kpis) {
  const trendIcon = kpis.tendenciaReportes >= 0 ? '↑' : '↓';
  const trendClass =
    kpis.tendenciaReportes > 0 ? 'up' : kpis.tendenciaReportes < 0 ? 'down' : 'neutral';

  return (
    `<div class="kpi-row">` +
    // Main KPIs
    `<div class="kpi-compact">` +
    `<div class="kpi-compact-header">` +
    `<span class="kpi-compact-label">Reportes Hoy</span>` +
    `<span class="kpi-compact-trend ${trendClass}">${trendIcon}${Math.abs(kpis.tendenciaReportes)}%</span>` +
    `</div>` +
    `<div class="kpi-compact-value">${kpis.reportesHoy}</div>` +
    `</div>` +
    `<div class="kpi-compact">` +
    `<span class="kpi-compact-label">Semana</span>` +
    `<div class="kpi-compact-value">${kpis.reportesSemana}</div>` +
    `</div>` +
    `<div class="kpi-compact">` +
    `<span class="kpi-compact-label">Resolución</span>` +
    `<div class="kpi-compact-value accent-green">${kpis.tasaResolucion}<span class="kpi-unit">%</span></div>` +
    `</div>` +
    `<div class="kpi-compact">` +
    `<span class="kpi-compact-label">Satisfacción</span>` +
    `<div class="kpi-compact-value">${kpis.satisfaccion || '—'}<span class="kpi-unit">/5</span></div>` +
    `</div>` +
    `<div class="kpi-compact">` +
    `<span class="kpi-compact-label">Activas</span>` +
    `<div class="kpi-compact-value accent-blue">${kpis.sesionesActivas}</div>` +
    `<span class="kpi-compact-sub">${kpis.sesionesConAgente} agente</span>` +
    `</div>` +
    `<div class="kpi-compact">` +
    `<span class="kpi-compact-label">Mensajes</span>` +
    `<div class="kpi-compact-value">${kpis.mensajesHoy}</div>` +
    `<span class="kpi-compact-sub">${kpis.mensajesEntrantes}↓ ${kpis.mensajesSalientes}↑</span>` +
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
    '<h3>Tendencia 7 Días</h3>' +
    '</div>' +
    '<div class="chart-canvas-container"><canvas id="trendChart"></canvas></div>' +
    '</div>' +
    '<div class="chart-box small">' +
    '<div class="chart-box-header">' +
    '<h3>Por Estado</h3>' +
    '</div>' +
    '<div class="chart-canvas-container"><canvas id="statusChart"></canvas></div>' +
    '</div>' +
    '<div class="chart-box small">' +
    '<div class="chart-box-header">' +
    '<h3>Por Tipo</h3>' +
    '</div>' +
    '<div class="chart-canvas-container"><canvas id="typeChart"></canvas></div>' +
    '</div>' +
    '</div>'
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
      const data = charts.tendencia7dias.map((d) => d.Total);

      chartInstances.trend = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              data: data,
              borderColor: '#E31837',
              backgroundColor: 'rgba(227, 24, 55, 0.1)',
              fill: true,
              tension: 0.4,
              pointBackgroundColor: '#fff',
              pointBorderColor: '#E31837',
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
        PENDIENTE: '#EF4444',
        EN_PROCESO: '#F59E0B',
        RESUELTO: '#10B981',
        CANCELADO: '#6B7280',
      };

      chartInstances.status = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: charts.porEstado.map((d) => d.EstadoNombre),
          datasets: [
            {
              data: charts.porEstado.map((d) => d.Total),
              backgroundColor: charts.porEstado.map((d) => colors[d.Estado] || '#3B82F6'),
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

  // Type doughnut chart
  if (charts.porTipo && charts.porTipo.length > 0) {
    const ctx = document.getElementById('typeChart');
    if (ctx) {
      const colors = ['#E31837', '#3B82F6', '#10B981', '#8B5CF6'];

      chartInstances.type = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: charts.porTipo.map((d) => d.TipoNombre),
          datasets: [
            {
              data: charts.porTipo.map((d) => d.Total),
              backgroundColor: colors.slice(0, charts.porTipo.length),
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
  loadKPIs,
  renderKPICards,
};
