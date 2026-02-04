/**
 * AC FIXBOT - Alerting Service (FASE 2)
 * Sistema de alertas configurable para monitoreo proactivo
 *
 * Características:
 * - Thresholds configurables por métrica
 * - Webhooks para notificaciones (Slack, Teams, custom)
 * - Alert aggregation para evitar spam
 * - Diferentes severidades: INFO, WARNING, ERROR, CRITICAL
 */

const axios = require('axios');
const { logger } = require('./errorHandler');

// ==============================================================
// CONFIGURACIÓN DE ALERTAS
// ==============================================================

/**
 * Configuración de thresholds por métrica
 */
const ALERT_THRESHOLDS = {
  // Error rates
  errorRate: {
    warning: 5, // 5% error rate
    critical: 10, // 10% error rate
  },
  // SLA compliance
  slaCompliance: {
    warning: 95, // 95% compliance (alerta si cae debajo)
    critical: 90, // 90% compliance
  },
  // Response times (ms)
  responseTime: {
    'webhook.process': { warning: 1500, critical: 3000 },
    'ai.generateResponse': { warning: 4000, critical: 8000 },
    'db.query': { warning: 800, critical: 1500 },
    'whatsapp.sendMessage': { warning: 3000, critical: 5000 },
    default: { warning: 3000, critical: 6000 },
  },
  // Memory usage
  memoryUsage: {
    warning: 80, // 80% heap usage
    critical: 90, // 90% heap usage
  },
  // Dead letter queue
  deadLetterQueue: {
    warning: 10, // 10 mensajes fallidos
    critical: 25, // 25 mensajes fallidos
  },
};

/**
 * Configuración de canales de notificación
 */
const NOTIFICATION_CHANNELS = {
  webhook: {
    enabled: Boolean(process.env.ALERT_WEBHOOK_URL),
    url: process.env.ALERT_WEBHOOK_URL,
  },
  log: {
    enabled: true, // Siempre loguear alertas
  },
};

// ==============================================================
// ALERT AGGREGATION (evitar spam)
// ==============================================================

// Tracking de últimas alertas enviadas
const alertHistory = new Map();
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos cooldown entre alertas del mismo tipo

/**
 * Verifica si una alerta puede ser enviada (no está en cooldown)
 */
function canSendAlert(alertKey) {
  const lastSent = alertHistory.get(alertKey);
  if (!lastSent) {
    return true;
  }

  const elapsed = Date.now() - lastSent;
  return elapsed >= ALERT_COOLDOWN_MS;
}

/**
 * Marca una alerta como enviada
 */
function markAlertSent(alertKey) {
  alertHistory.set(alertKey, Date.now());
}

/**
 * Genera una clave única para una alerta
 */
function getAlertKey(type, metric) {
  return `${type}:${metric}`;
}

// ==============================================================
// ALERT CREATION Y NOTIFICATION
// ==============================================================

/**
 * Crea un objeto de alerta estructurado
 */
function createAlert(severity, type, message, details = {}) {
  return {
    severity,
    type,
    message,
    details,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    service: 'acfixbot',
  };
}

/**
 * Envía alerta a través de webhook
 */
async function sendWebhookAlert(alert) {
  if (!NOTIFICATION_CHANNELS.webhook.enabled) {
    return { sent: false, reason: 'Webhook not configured' };
  }

  try {
    const payload = formatWebhookPayload(alert);

    await axios.post(NOTIFICATION_CHANNELS.webhook.url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    });

    return { sent: true };
  } catch (error) {
    logger.error('[Alerting] Error enviando webhook', error, { alert });
    return { sent: false, error: error.message };
  }
}

/**
 * Formatea payload para webhook (compatible con Slack/Teams)
 */
function formatWebhookPayload(alert) {
  const emoji =
    {
      INFO: 'ℹ️',
      WARNING: '⚠️',
      ERROR: '❌',
      CRITICAL: '🚨',
    }[alert.severity] || '📢';

  // Formato compatible con Slack
  const slackPayload = {
    text: `${emoji} ${alert.severity}: ${alert.message}`,
    attachments: [
      {
        color:
          {
            INFO: 'good',
            WARNING: 'warning',
            ERROR: 'danger',
            CRITICAL: 'danger',
          }[alert.severity] || '#808080',
        fields: [
          { title: 'Type', value: alert.type, short: true },
          { title: 'Environment', value: alert.environment, short: true },
          { title: 'Timestamp', value: alert.timestamp, short: false },
        ],
        footer: 'AC FixBot Monitoring',
      },
    ],
  };

  // Agregar detalles adicionales si existen
  if (alert.details && Object.keys(alert.details).length > 0) {
    for (const [key, value] of Object.entries(alert.details)) {
      slackPayload.attachments[0].fields.push({
        title: key,
        value: String(value),
        short: true,
      });
    }
  }

  return slackPayload;
}

/**
 * Envía alerta (distribuye a todos los canales configurados)
 */
async function sendAlert(alert) {
  const alertKey = getAlertKey(alert.type, alert.message);

  // Check cooldown
  if (!canSendAlert(alertKey)) {
    logger.debug('[Alerting] Alerta en cooldown, omitiendo', { alertKey });
    return { sent: false, reason: 'cooldown' };
  }

  // Log alert
  if (NOTIFICATION_CHANNELS.log.enabled) {
    const logMethod =
      {
        INFO: 'info',
        WARNING: 'warn',
        ERROR: 'error',
        CRITICAL: 'error',
      }[alert.severity] || 'info';

    logger[logMethod](`[ALERT] ${alert.message}`, alert.details);
  }

  // Send webhook
  const webhookResult = await sendWebhookAlert(alert);

  // Mark as sent
  markAlertSent(alertKey);

  return {
    sent: true,
    channels: {
      log: NOTIFICATION_CHANNELS.log.enabled,
      webhook: webhookResult.sent,
    },
  };
}

// ==============================================================
// METRIC EVALUATION (llamado por metricsService)
// ==============================================================

/**
 * Evalúa métricas y genera alertas si se exceden thresholds
 */
async function evaluateMetrics(metricsSummary) {
  const alerts = [];

  // 1. Evaluar error rates
  for (const [operation, errorRate] of Object.entries(metricsSummary.errorRates || {})) {
    const rate = parseFloat(errorRate.rate);
    if (rate >= ALERT_THRESHOLDS.errorRate.critical) {
      alerts.push(
        createAlert(
          'CRITICAL',
          'error_rate',
          `Error rate crítico en ${operation}: ${errorRate.rate}`,
          {
            operation,
            errorRate: errorRate.rate,
            threshold: `${ALERT_THRESHOLDS.errorRate.critical}%`,
          }
        )
      );
    } else if (rate >= ALERT_THRESHOLDS.errorRate.warning) {
      alerts.push(
        createAlert(
          'WARNING',
          'error_rate',
          `Error rate elevado en ${operation}: ${errorRate.rate}`,
          {
            operation,
            errorRate: errorRate.rate,
            threshold: `${ALERT_THRESHOLDS.errorRate.warning}%`,
          }
        )
      );
    }
  }

  // 2. Evaluar SLA compliance
  for (const [operation, sla] of Object.entries(metricsSummary.slaCompliance || {})) {
    const compliance = parseFloat(sla.complianceRate);
    if (compliance < ALERT_THRESHOLDS.slaCompliance.critical) {
      alerts.push(
        createAlert(
          'CRITICAL',
          'sla_breach',
          `SLA crítico en ${operation}: ${sla.complianceRate} compliance`,
          {
            operation,
            compliance: sla.complianceRate,
            threshold: `${ALERT_THRESHOLDS.slaCompliance.critical}%`,
          }
        )
      );
    } else if (compliance < ALERT_THRESHOLDS.slaCompliance.warning) {
      alerts.push(
        createAlert(
          'WARNING',
          'sla_breach',
          `SLA degradado en ${operation}: ${sla.complianceRate} compliance`,
          {
            operation,
            compliance: sla.complianceRate,
            threshold: `${ALERT_THRESHOLDS.slaCompliance.warning}%`,
          }
        )
      );
    }
  }

  // 3. Evaluar response times (p95)
  for (const [operation, percentiles] of Object.entries(metricsSummary.percentiles || {})) {
    const p95 = percentiles.p95;
    const threshold =
      ALERT_THRESHOLDS.responseTime[operation] || ALERT_THRESHOLDS.responseTime.default;

    if (p95 >= threshold.critical) {
      alerts.push(
        createAlert('CRITICAL', 'high_latency', `Latencia crítica en ${operation}: p95=${p95}ms`, {
          operation,
          p95,
          threshold: `${threshold.critical}ms`,
        })
      );
    } else if (p95 >= threshold.warning) {
      alerts.push(
        createAlert('WARNING', 'high_latency', `Latencia elevada en ${operation}: p95=${p95}ms`, {
          operation,
          p95,
          threshold: `${threshold.warning}ms`,
        })
      );
    }
  }

  // Enviar todas las alertas generadas
  for (const alert of alerts) {
    await sendAlert(alert);
  }

  return alerts;
}

/**
 * Evalúa health check y genera alertas
 */
async function evaluateHealthCheck(healthData) {
  const alerts = [];

  // Alerta si el sistema está unhealthy
  if (healthData.status === 'unhealthy') {
    alerts.push(
      createAlert('CRITICAL', 'system_unhealthy', 'Sistema reporta estado UNHEALTHY', {
        checks: Object.entries(healthData.checks || {})
          .filter(([_, check]) => check.status === 'unhealthy')
          .map(([name]) => name),
      })
    );
  } else if (healthData.status === 'degraded') {
    alerts.push(
      createAlert('WARNING', 'system_degraded', 'Sistema reporta estado DEGRADED', {
        checks: Object.entries(healthData.checks || {})
          .filter(([_, check]) => check.status === 'degraded' || check.status === 'warning')
          .map(([name]) => name),
      })
    );
  }

  // Alerta por memoria alta
  if (healthData.checks?.memory?.heapPercentage >= ALERT_THRESHOLDS.memoryUsage.critical) {
    alerts.push(
      createAlert(
        'CRITICAL',
        'high_memory',
        `Uso de memoria crítico: ${healthData.checks.memory.heapPercentage}%`,
        { heapUsedMB: healthData.checks.memory.heapUsedMB }
      )
    );
  } else if (healthData.checks?.memory?.heapPercentage >= ALERT_THRESHOLDS.memoryUsage.warning) {
    alerts.push(
      createAlert(
        'WARNING',
        'high_memory',
        `Uso de memoria elevado: ${healthData.checks.memory.heapPercentage}%`,
        { heapUsedMB: healthData.checks.memory.heapUsedMB }
      )
    );
  }

  // Alerta por dead letter queue
  const dlqFailed = healthData.checks?.deadLetter?.failed || 0;
  if (dlqFailed >= ALERT_THRESHOLDS.deadLetterQueue.critical) {
    alerts.push(
      createAlert(
        'CRITICAL',
        'dlq_overload',
        `Dead Letter Queue crítica: ${dlqFailed} mensajes fallidos`,
        { failed: dlqFailed, total: healthData.checks?.deadLetter?.total }
      )
    );
  } else if (dlqFailed >= ALERT_THRESHOLDS.deadLetterQueue.warning) {
    alerts.push(
      createAlert(
        'WARNING',
        'dlq_overload',
        `Dead Letter Queue elevada: ${dlqFailed} mensajes fallidos`,
        { failed: dlqFailed, total: healthData.checks?.deadLetter?.total }
      )
    );
  }

  // Enviar todas las alertas generadas
  for (const alert of alerts) {
    await sendAlert(alert);
  }

  return alerts;
}

/**
 * Envía alerta manual (para uso en código)
 */
async function sendManualAlert(severity, type, message, details = {}) {
  const alert = createAlert(severity, type, message, details);
  return sendAlert(alert);
}

// ==============================================================
// UTILIDADES
// ==============================================================

/**
 * Obtiene estadísticas de alertas
 */
function getAlertStats() {
  return {
    alertsInCooldown: alertHistory.size,
    cooldownDurationMs: ALERT_COOLDOWN_MS,
    thresholds: ALERT_THRESHOLDS,
    channels: {
      webhook: {
        enabled: NOTIFICATION_CHANNELS.webhook.enabled,
        configured: Boolean(NOTIFICATION_CHANNELS.webhook.url),
      },
      log: NOTIFICATION_CHANNELS.log,
    },
  };
}

/**
 * Limpia historial de alertas antiguas (llamar periódicamente)
 */
function cleanAlertHistory() {
  const now = Date.now();
  const cleaned = [];

  for (const [key, timestamp] of alertHistory.entries()) {
    if (now - timestamp > ALERT_COOLDOWN_MS) {
      alertHistory.delete(key);
      cleaned.push(key);
    }
  }

  if (cleaned.length > 0) {
    logger.debug('[Alerting] Historial de alertas limpiado', { cleaned: cleaned.length });
  }

  return cleaned.length;
}

// Limpiar historial cada 10 minutos
setInterval(cleanAlertHistory, 10 * 60 * 1000).unref();

module.exports = {
  // Core functions
  sendAlert,
  sendManualAlert,
  evaluateMetrics,
  evaluateHealthCheck,
  // Utilities
  getAlertStats,
  cleanAlertHistory,
  // Para testing
  createAlert,
  ALERT_THRESHOLDS,
};
