/**
 * Tests para Alerting System (FASE 2)
 * - Alert creation y severity
 * - Threshold evaluation
 * - Alert aggregation (cooldown)
 * - Webhook notifications
 * - Metrics evaluation
 */

const axios = require('axios');

// Mock axios
jest.mock('axios');

// Mock logger
jest.mock('../../core/services/infrastructure/errorHandler', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

let alertingService;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();

  // Reset env vars
  delete process.env.ALERT_WEBHOOK_URL;

  alertingService = require('../../core/services/infrastructure/alertingService');
});

describe('Alerting System - Alert Creation', () => {
  test('debe crear alerta con estructura correcta', () => {
    const alert = alertingService.createAlert('WARNING', 'test_alert', 'Test message', {
      key: 'value',
    });

    expect(alert).toHaveProperty('severity', 'WARNING');
    expect(alert).toHaveProperty('type', 'test_alert');
    expect(alert).toHaveProperty('message', 'Test message');
    expect(alert).toHaveProperty('details', { key: 'value' });
    expect(alert).toHaveProperty('timestamp');
    expect(alert).toHaveProperty('environment');
    expect(alert).toHaveProperty('service', 'acfixbot');
  });

  test('debe soportar diferentes severidades', () => {
    const severities = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'];

    severities.forEach((severity) => {
      const alert = alertingService.createAlert(severity, 'test', 'message');
      expect(alert.severity).toBe(severity);
    });
  });
});

describe('Alerting System - Alert Aggregation (Cooldown)', () => {
  test('debe enviar primera alerta sin cooldown', async () => {
    const result = await alertingService.sendAlert(
      alertingService.createAlert('INFO', 'test', 'First alert')
    );

    expect(result.sent).toBe(true);
  });

  test('debe bloquear alertas duplicadas en cooldown', async () => {
    // Primera alerta
    const alert1 = alertingService.createAlert('INFO', 'duplicate_test', 'Same alert');
    const result1 = await alertingService.sendAlert(alert1);
    expect(result1.sent).toBe(true);

    // Segunda alerta inmediata (misma clave)
    const alert2 = alertingService.createAlert('INFO', 'duplicate_test', 'Same alert');
    const result2 = await alertingService.sendAlert(alert2);
    expect(result2.sent).toBe(false);
    expect(result2.reason).toBe('cooldown');
  });

  test('debe permitir alertas de diferentes tipos simultáneamente', async () => {
    const alert1 = alertingService.createAlert('INFO', 'type_a', 'Alert A');
    const alert2 = alertingService.createAlert('INFO', 'type_b', 'Alert B');

    const result1 = await alertingService.sendAlert(alert1);
    const result2 = await alertingService.sendAlert(alert2);

    expect(result1.sent).toBe(true);
    expect(result2.sent).toBe(true);
  });
});

describe('Alerting System - Webhook Notifications', () => {
  test('debe enviar webhook cuando está configurado', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.slack.com/test';
    axios.post.mockResolvedValue({ status: 200 });

    // Reload module para tomar nueva env var
    jest.resetModules();
    const service = require('../../core/services/infrastructure/alertingService');

    const alert = service.createAlert('WARNING', 'test', 'Test webhook');
    await service.sendAlert(alert);

    expect(axios.post).toHaveBeenCalledWith(
      'https://hooks.slack.com/test',
      expect.objectContaining({
        text: expect.stringContaining('WARNING'),
        attachments: expect.any(Array),
      }),
      expect.any(Object)
    );
  });

  test('debe formatear payload compatible con Slack', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.slack.com/test';
    axios.post.mockResolvedValue({ status: 200 });

    jest.resetModules();
    const service = require('../../core/services/infrastructure/alertingService');

    const alert = service.createAlert('CRITICAL', 'test', 'Critical issue', {
      errorRate: '15%',
      operation: 'webhook.process',
    });
    await service.sendAlert(alert);

    const payload = axios.post.mock.calls[0][1];

    expect(payload).toHaveProperty('text');
    expect(payload.text).toContain('🚨');
    expect(payload.text).toContain('CRITICAL');
    expect(payload).toHaveProperty('attachments');
    expect(payload.attachments[0].color).toBe('danger');
    expect(payload.attachments[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Type', value: 'test' }),
        expect.objectContaining({ title: 'errorRate', value: '15%' }),
        expect.objectContaining({ title: 'operation', value: 'webhook.process' }),
      ])
    );
  });

  test('debe manejar error en webhook sin fallar', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.slack.com/test';
    axios.post.mockRejectedValue(new Error('Network error'));

    jest.resetModules();
    const service = require('../../core/services/infrastructure/alertingService');

    const alert = service.createAlert('INFO', 'test', 'Test');

    // No debe lanzar error
    await expect(service.sendAlert(alert)).resolves.toBeDefined();
  });
});

describe('Alerting System - Metrics Evaluation', () => {
  test('debe generar alerta por error rate elevado', async () => {
    const metricsSummary = {
      errorRates: {
        'webhook.process': {
          total: 100,
          errors: 12,
          rate: '12.00%', // Excede threshold de 10% (critical)
        },
      },
      slaCompliance: {},
      percentiles: {},
    };

    const alerts = await alertingService.evaluateMetrics(metricsSummary);

    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].type).toBe('error_rate');
    expect(alerts[0].severity).toBe('CRITICAL');
    expect(alerts[0].message).toContain('webhook.process');
    expect(alerts[0].message).toContain('12.00%');
  });

  test('debe generar alerta por SLA breach', async () => {
    const metricsSummary = {
      errorRates: {},
      slaCompliance: {
        'ai.generateResponse': {
          complianceRate: '88.00%', // Por debajo de 90% (critical)
          within: 88,
          exceeded: 12,
          target: '3000ms',
        },
      },
      percentiles: {},
    };

    const alerts = await alertingService.evaluateMetrics(metricsSummary);

    expect(alerts.length).toBeGreaterThan(0);
    const slaAlert = alerts.find((a) => a.type === 'sla_breach');
    expect(slaAlert).toBeDefined();
    expect(slaAlert.severity).toBe('CRITICAL');
    expect(slaAlert.message).toContain('ai.generateResponse');
    expect(slaAlert.message).toContain('88.00%');
  });

  test('debe generar alerta por high latency', async () => {
    const metricsSummary = {
      errorRates: {},
      slaCompliance: {},
      percentiles: {
        'db.query': {
          p50: 200,
          p75: 400,
          p95: 1600, // Excede 1500ms (critical para db.query)
          p99: 2000,
        },
      },
    };

    const alerts = await alertingService.evaluateMetrics(metricsSummary);

    expect(alerts.length).toBeGreaterThan(0);
    const latencyAlert = alerts.find((a) => a.type === 'high_latency');
    expect(latencyAlert).toBeDefined();
    expect(latencyAlert.severity).toBe('CRITICAL');
    expect(latencyAlert.message).toContain('db.query');
    expect(latencyAlert.message).toContain('p95=1600ms');
  });

  test('NO debe generar alertas si todo está dentro de thresholds', async () => {
    const metricsSummary = {
      errorRates: {
        'webhook.process': {
          total: 100,
          errors: 2,
          rate: '2.00%', // Dentro de threshold
        },
      },
      slaCompliance: {
        'webhook.process': {
          complianceRate: '98.00%', // Dentro de threshold (>95%)
          within: 98,
          exceeded: 2,
        },
      },
      percentiles: {
        'webhook.process': {
          p95: 800, // Dentro de threshold (<1500ms)
        },
      },
    };

    const alerts = await alertingService.evaluateMetrics(metricsSummary);

    expect(alerts.length).toBe(0);
  });
});

describe('Alerting System - Health Check Evaluation', () => {
  test('debe generar alerta por sistema unhealthy', async () => {
    const healthData = {
      status: 'unhealthy',
      checks: {
        database: { status: 'unhealthy' },
        whatsappApi: { status: 'unhealthy' },
      },
    };

    const alerts = await alertingService.evaluateHealthCheck(healthData);

    expect(alerts.length).toBeGreaterThan(0);
    const systemAlert = alerts.find((a) => a.type === 'system_unhealthy');
    expect(systemAlert).toBeDefined();
    expect(systemAlert.severity).toBe('CRITICAL');
  });

  test('debe generar alerta por high memory usage', async () => {
    const healthData = {
      status: 'healthy',
      checks: {
        memory: {
          heapPercentage: 92, // Excede 90% (critical)
          heapUsedMB: 920,
          heapTotalMB: 1000,
        },
      },
    };

    const alerts = await alertingService.evaluateHealthCheck(healthData);

    const memoryAlert = alerts.find((a) => a.type === 'high_memory');
    expect(memoryAlert).toBeDefined();
    expect(memoryAlert.severity).toBe('CRITICAL');
    expect(memoryAlert.message).toContain('92%');
  });

  test('debe generar alerta por DLQ overload', async () => {
    const healthData = {
      status: 'healthy',
      checks: {
        deadLetter: {
          total: 30,
          pending: 5,
          failed: 25, // Excede 25 (critical)
        },
      },
    };

    const alerts = await alertingService.evaluateHealthCheck(healthData);

    const dlqAlert = alerts.find((a) => a.type === 'dlq_overload');
    expect(dlqAlert).toBeDefined();
    expect(dlqAlert.severity).toBe('CRITICAL');
    expect(dlqAlert.message).toContain('25 mensajes fallidos');
  });
});

describe('Alerting System - Manual Alerts', () => {
  test('debe enviar alerta manual', async () => {
    const result = await alertingService.sendManualAlert(
      'ERROR',
      'custom_error',
      'Custom error message',
      { context: 'test' }
    );

    expect(result).toBeDefined();
    expect(result.sent).toBe(true);
  });
});

describe('Alerting System - Utilities', () => {
  test('debe retornar estadísticas de alertas', () => {
    const stats = alertingService.getAlertStats();

    expect(stats).toHaveProperty('alertsInCooldown');
    expect(stats).toHaveProperty('cooldownDurationMs');
    expect(stats).toHaveProperty('thresholds');
    expect(stats).toHaveProperty('channels');
    expect(stats.channels).toHaveProperty('webhook');
    expect(stats.channels).toHaveProperty('log');
  });

  test('debe limpiar historial de alertas antiguas', () => {
    const cleaned = alertingService.cleanAlertHistory();
    expect(typeof cleaned).toBe('number');
  });
});
