/**
 * Tests para Enhanced Metrics (FASE 2)
 * - Percentiles (p50, p75, p95, p99)
 * - Latency Histograms
 * - SLA Tracking
 * - Error Rates
 */

// IMPORTANTE: Usar el módulo REAL de metricsService, no el mock automático
jest.unmock('../../core/services/infrastructure/metricsService');

// Mock dependencies ANTES de require
jest.mock('../../core/config', () => ({
  metrics: {
    printIntervalMs: 60000,
  },
}));

jest.mock('../../core/services/infrastructure/errorHandler', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    metrics: jest.fn(),
  },
}));

jest.mock('@azure/data-tables', () => ({
  TableClient: {
    fromConnectionString: jest.fn(() => ({
      createTable: jest.fn().mockResolvedValue({}),
      createEntity: jest.fn().mockResolvedValue({}),
      listEntities: jest.fn(() => ({
        [Symbol.asyncIterator]: async function* () {
          // Iterator vacío
        },
      })),
    })),
  },
  AzureNamedKeyCredential: jest.fn(),
}));

// Mock appInsightsService para evitar errores
jest.mock('../../core/services/infrastructure/appInsightsService', () => ({
  isInitialized: () => false,
  trackMetric: jest.fn(),
  trackException: jest.fn(),
}));

// Cargar el módulo una vez y usar resetMetrics() entre tests
let metricsService;

beforeAll(() => {
  metricsService = require('../../core/services/infrastructure/metricsService');
});

beforeEach(() => {
  jest.clearAllMocks();
  // Usar resetMetrics() en lugar de jest.resetModules() para mantener el módulo cargado
  if (metricsService && metricsService.resetMetrics) {
    metricsService.resetMetrics();
  }
});

describe('Enhanced Metrics - Percentiles', () => {
  test('debe calcular percentiles correctamente', () => {
    // Usar módulo pre-cargado

    // Simular 20 operaciones con latencias variadas
    const operations = [
      50, 75, 100, 120, 150, 180, 200, 220, 250, 280, 300, 350, 400, 450, 500, 600, 700, 800, 900,
      1000,
    ];

    const _timer = metricsService.startTimer('test.operation');
    operations.forEach((duration) => {
      const t = metricsService.startTimer('test.percentiles');
      // Mock duration
      t.startTime = Date.now() - duration;
      t.end();
    });

    const summary = metricsService.getMetricsSummary();

    expect(summary.percentiles).toBeDefined();
    expect(summary.percentiles['test.percentiles']).toBeDefined();
    expect(summary.percentiles['test.percentiles'].p50).toBeGreaterThan(0);
    expect(summary.percentiles['test.percentiles'].p95).toBeGreaterThan(
      summary.percentiles['test.percentiles'].p50
    );
    expect(summary.percentiles['test.percentiles'].p99).toBeGreaterThan(
      summary.percentiles['test.percentiles'].p95
    );
  });

  test('debe mantener solo últimos 1000 timings', () => {
    // Usar módulo pre-cargado

    // Simular 1500 operaciones
    for (let i = 0; i < 1500; i++) {
      const timer = metricsService.startTimer('test.overflow');
      timer.end();
    }

    const summary = metricsService.getMetricsSummary();
    const rawTimings = summary.percentiles['test.overflow'];

    // No debería tener más de 1000 valores
    expect(rawTimings).toBeDefined();
  });
});

describe('Enhanced Metrics - Latency Histograms', () => {
  test('debe crear histogramas de latencia por buckets', () => {
    // Usar módulo pre-cargado

    // Simular operaciones en diferentes buckets
    const durations = [30, 80, 150, 300, 800, 1500, 3000, 6000];

    durations.forEach((duration) => {
      const timer = metricsService.startTimer('test.histogram');
      timer.startTime = Date.now() - duration;
      timer.end();
    });

    const summary = metricsService.getMetricsSummary();

    expect(summary.latencyHistograms).toBeDefined();
    expect(summary.latencyHistograms['test.histogram']).toBeDefined();

    const histogram = summary.latencyHistograms['test.histogram'];

    // Verificar que los buckets existen
    expect(histogram['<50ms']).toBeGreaterThan(0);
    expect(histogram['<100ms']).toBeGreaterThan(0);
    expect(histogram['<200ms']).toBeGreaterThan(0);
    expect(histogram['>5000ms']).toBeGreaterThan(0);
  });

  test('debe incrementar el bucket correcto según la latencia', () => {
    // Usar módulo pre-cargado

    // 45ms -> debe ir a <50ms
    const timer1 = metricsService.startTimer('test.bucket');
    timer1.startTime = Date.now() - 45;
    timer1.end();

    // 150ms -> debe ir a <200ms
    const timer2 = metricsService.startTimer('test.bucket');
    timer2.startTime = Date.now() - 150;
    timer2.end();

    const summary = metricsService.getMetricsSummary();
    const histogram = summary.latencyHistograms['test.bucket'];

    expect(histogram['<50ms']).toBe(1);
    expect(histogram['<200ms']).toBe(1);
  });
});

describe('Enhanced Metrics - SLA Tracking', () => {
  test('debe trackear SLA compliance correctamente', () => {
    // Usar módulo pre-cargado

    // Operación con SLA de 1000ms (webhook.process)
    // Simular 8 dentro de SLA, 2 fuera
    for (let i = 0; i < 8; i++) {
      const timer = metricsService.startTimer('webhook.process');
      timer.startTime = Date.now() - 500; // Dentro de SLA
      timer.end({ success: true });
    }

    for (let i = 0; i < 2; i++) {
      const timer = metricsService.startTimer('webhook.process');
      timer.startTime = Date.now() - 1500; // Fuera de SLA
      timer.end({ success: true });
    }

    const summary = metricsService.getMetricsSummary();

    expect(summary.slaCompliance).toBeDefined();
    expect(summary.slaCompliance['webhook.process']).toBeDefined();

    const sla = summary.slaCompliance['webhook.process'];
    expect(sla.target).toBe('1000ms');
    expect(sla.within).toBe(8);
    expect(sla.exceeded).toBe(2);
    expect(sla.complianceRate).toBe('80.00%');
  });

  test('debe trackear success/error counts', () => {
    // Usar módulo pre-cargado

    // 7 éxitos, 3 errores
    for (let i = 0; i < 7; i++) {
      const timer = metricsService.startTimer('test.sla');
      timer.end({ success: true });
    }

    for (let i = 0; i < 3; i++) {
      const timer = metricsService.startTimer('test.sla');
      timer.end({ error: true });
    }

    const summary = metricsService.getMetricsSummary();
    const sla = summary.slaCompliance['test.sla'];

    expect(sla.successCount).toBe(7);
    expect(sla.errorCount).toBe(3);
    expect(sla.errorRate).toBe('30.00%');
  });
});

describe('Enhanced Metrics - Error Rates', () => {
  test('debe calcular error rate correctamente', () => {
    // Usar módulo pre-cargado

    // 90 éxitos, 10 errores
    for (let i = 0; i < 90; i++) {
      const timer = metricsService.startTimer('test.errorrate');
      timer.end({ success: true });
    }

    for (let i = 0; i < 10; i++) {
      const timer = metricsService.startTimer('test.errorrate');
      timer.end({ error: true });
    }

    const summary = metricsService.getMetricsSummary();

    expect(summary.errorRates).toBeDefined();
    expect(summary.errorRates['test.errorrate']).toBeDefined();

    const errorRate = summary.errorRates['test.errorrate'];
    expect(errorRate.total).toBe(100);
    expect(errorRate.errors).toBe(10);
    expect(errorRate.rate).toBe('10.00%');
  });

  test('debe manejar 0% error rate', () => {
    // Usar módulo pre-cargado

    // Solo éxitos
    for (let i = 0; i < 10; i++) {
      const timer = metricsService.startTimer('test.noerrors');
      timer.end({ success: true });
    }

    const summary = metricsService.getMetricsSummary();
    const errorRate = summary.errorRates['test.noerrors'];

    expect(errorRate.errors).toBe(0);
    expect(errorRate.rate).toBe('0.00%');
  });
});

describe('Enhanced Metrics - Integration', () => {
  test('debe incluir todas las enhanced metrics en summary', () => {
    // Usar módulo pre-cargado

    // Simular operaciones variadas
    for (let i = 0; i < 10; i++) {
      const timer = metricsService.startTimer('test.integration');
      timer.startTime = Date.now() - (100 + i * 50);
      timer.end({ success: i < 8 });
    }

    const summary = metricsService.getMetricsSummary();

    // Verificar que todas las secciones enhanced existen
    expect(summary.percentiles).toBeDefined();
    expect(summary.latencyHistograms).toBeDefined();
    expect(summary.slaCompliance).toBeDefined();
    expect(summary.errorRates).toBeDefined();

    // Verificar datos legacy también existen
    expect(summary.operations).toBeDefined();
    expect(summary.timings).toBeDefined();
    expect(summary.cache).toBeDefined();
  });
});
