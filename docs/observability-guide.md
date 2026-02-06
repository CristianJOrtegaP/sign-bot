# AC FixBot - Observability Guide (FASE 2)

## Overview

Este documento describe las mejores prácticas de observability implementadas en AC FixBot, incluyendo logging estructurado, distributed tracing, y métricas.

## 1. Logging Estructurado

### Uso del Logger

```javascript
const { logger } = require('../core/services/infrastructure/errorHandler');

// Logs con contexto estructurado
logger.info('Mensaje procesado', {
  messageId: 'wamid.123',
  telefono: '+5215512345678',
  duration_ms: 245,
});

logger.error('Error procesando mensaje', error, {
  messageId: 'wamid.123',
  telefono: '+5215512345678',
  estadoSesion: 'REFRI_ESPERA_SAP',
});
```

### Niveles de Log

- **debug**: Información detallada para debugging (solo en desarrollo)
- **info**: Eventos normales del sistema
- **warn**: Situaciones que requieren atención pero no son errores
- **error**: Errores que requieren investigación
- **metrics**: Métricas de performance y operaciones

### Mejores Prácticas

1. **Siempre incluir contexto relevante**:

   ```javascript
   // ❌ Malo
   logger.info('Usuario creado');

   // ✅ Bueno
   logger.info('Usuario creado', { userId, email, role });
   ```

2. **Usar structured logging para búsquedas**:

   ```javascript
   // ✅ Permite buscar por messageId en logs
   logger.info('Mensaje enviado', { messageId, telefono, success: true });
   ```

3. **No loguear información sensible**:

   ```javascript
   // ❌ Malo
   logger.info('Login', { password: user.password });

   // ✅ Bueno
   logger.info('Login exitoso', { userId: user.id, method: 'password' });
   ```

## 2. Distributed Tracing

### Correlation IDs

Cada request tiene un correlation ID único que se propaga a través de todos los servicios.

```javascript
const correlation = require('../core/services/infrastructure/correlationService');

// Iniciar nuevo contexto
correlation.initContext();
const correlationId = correlation.getCorrelationId();

// El correlationId se incluye automáticamente en:
// - Logs estructurados
// - Métricas
// - Queries SQL
// - Dead Letter Queue
```

### Propagación de Context

```javascript
// En handlers de Azure Functions
correlation.initContext();

try {
  await processWebhook(data);
} finally {
  correlation.clearContext();
}
```

### Buscar por Correlation ID

Para rastrear una request completa en los logs:

```bash
# Azure Application Insights
traces
| where customDimensions.correlationId == "abc-123-def"
| order by timestamp asc

# Logs locales
grep "abc-123-def" logs/*.log
```

## 3. Métricas y Performance

### Performance Timers

```javascript
const metricsService = require('../core/services/infrastructure/metricsService');

// Iniciar timer
const timer = metricsService.startTimer('webhook.process', context);

try {
  await processMessage(message);

  // Finalizar con éxito
  timer.end({ success: true, messageType: 'text' });
} catch (error) {
  // Finalizar con error
  timer.end({ error: true, errorType: error.name });
  throw error;
}
```

### Métricas Automáticas (FASE 2)

El sistema ahora captura automáticamente:

- **Percentiles**: p50, p75, p95, p99 de latencia
- **Histogramas**: Distribución de latencias en buckets
- **SLA Compliance**: % de operaciones dentro del SLA target
- **Error Rates**: Tasa de errores por operación
- **Throughput**: Operaciones por segundo

### Ver Métricas

```bash
# Real-time metrics
GET /api/metrics
x-functions-key: <AZURE_FUNCTION_KEY>

# Métricas de una operación específica
GET /api/metrics?operation=webhook.process

# Métricas históricas
GET /api/metrics?historical=true&date=2025-01-15
```

## 4. Health Checks (FASE 2 Enhanced)

### Health Check Activo

El endpoint `/api/health` ahora incluye checks activos:

- **Database**: Verifica conexión + tablas + pool stats
- **WhatsApp API**: Request real a Meta API
- **AI Provider**: Verifica que Gemini/Azure OpenAI responda
- **Circuit Breakers**: Estado de todos los breakers
- **Dead Letter Queue**: Stats de mensajes fallidos
- **Metrics Service**: Estado del sistema de métricas

### Ejemplo de Response

```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00Z",
  "version": "2.0.0",
  "environment": "production",
  "responseTimeMs": 245,
  "checks": {
    "database": {
      "status": "healthy",
      "responseTimeMs": 15,
      "details": {
        "tablesFound": 4,
        "poolStats": {
          "size": 5,
          "available": 4,
          "borrowed": 1
        }
      }
    },
    "whatsappApi": {
      "status": "healthy",
      "message": "WhatsApp API responding",
      "details": {
        "phoneNumber": "+52 55 1234 5678",
        "qualityRating": "GREEN"
      }
    },
    "aiProvider": {
      "status": "healthy",
      "provider": "gemini"
    }
  }
}
```

## 5. Alerting (FASE 2)

### Configuración de Alertas

Las alertas se configuran mediante variables de entorno:

```bash
# Webhook para alertas (Slack, Teams, etc.)
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...

# Thresholds (opcional, hay defaults)
ALERT_ERROR_RATE_WARNING=5
ALERT_ERROR_RATE_CRITICAL=10
ALERT_SLA_WARNING=95
ALERT_SLA_CRITICAL=90
```

### Alertas Automáticas

El sistema genera alertas automáticamente para:

- **Error Rate**: Cuando la tasa de errores excede el threshold
- **SLA Breach**: Cuando el SLA compliance cae por debajo del threshold
- **High Latency**: Cuando p95 excede el límite configurado
- **High Memory**: Cuando el uso de heap excede 80% (warning) o 90% (critical)
- **DLQ Overload**: Cuando hay muchos mensajes fallidos
- **System Unhealthy**: Cuando el health check reporta unhealthy

### Enviar Alertas Manuales

```javascript
const alertingService = require('../core/services/infrastructure/alertingService');

await alertingService.sendManualAlert('WARNING', 'custom_alert', 'Descripción del problema', {
  context: 'additional details',
});
```

### Alert Aggregation

Las alertas tienen un cooldown de 5 minutos para evitar spam. La misma alerta no se enviará más de una vez cada 5 minutos.

## 6. Dead Letter Queue (FASE 2 Enhanced)

### Procesamiento Automático

El timer `timer-dlq-processor` se ejecuta cada 10 minutos y:

1. Obtiene mensajes pendientes de retry
2. Intenta reprocesarlos
3. Marca como PROCESSED si tiene éxito
4. Incrementa retry count si falla
5. Marca como FAILED si excede MaxRetries (3)
6. Envía alertas si hay mensajes fallidos permanentemente

### Monitoreo del DLQ

```bash
# Ver estadísticas
GET /api/health

# Buscar mensajes en DLQ
SELECT * FROM DeadLetterMessages
WHERE Estado = 'PENDING'
ORDER BY FechaCreacion DESC

# Ver mensajes fallidos permanentemente
SELECT * FROM DeadLetterMessages
WHERE Estado = 'FAILED'
ORDER BY FechaCreacion DESC
```

## 7. Azure Application Insights Integration

### Queries Útiles

```kusto
// Buscar por correlation ID
traces
| where customDimensions.correlationId == "abc-123"
| order by timestamp asc

// Errores en las últimas 24h
traces
| where severityLevel >= 3
| where timestamp > ago(24h)
| summarize count() by operation_Name, message
| order by count_ desc

// Latencia p95 por operación
traces
| where message contains "[METRICS]"
| extend duration = todouble(customDimensions.duration_ms)
| summarize p95=percentile(duration, 95) by operation=tostring(customDimensions.operation)
| order by p95 desc

// SLA compliance
let targetSla = 1000; // 1s
traces
| where message contains "[METRICS]"
| extend duration = todouble(customDimensions.duration_ms)
| summarize
    total=count(),
    within=countif(duration <= targetSla),
    exceeded=countif(duration > targetSla)
| extend complianceRate = (within * 100.0) / total
```

## 8. Troubleshooting

### Problema: No veo métricas

**Verificar**:

1. ¿Está el timer de métricas ejecutándose? (cada 60s por default)
2. ¿Hay operaciones siendo medidas con `startTimer()`?
3. Check logs por errores en `metricsService`

### Problema: No recibo alertas

**Verificar**:

1. ¿Está configurado `ALERT_WEBHOOK_URL`?
2. ¿Las métricas exceden los thresholds?
3. ¿La alerta está en cooldown? (5 minutos entre alertas del mismo tipo)
4. Check logs por errores en `alertingService`

### Problema: DLQ no procesa mensajes

**Verificar**:

1. ¿Está el timer `timer-dlq-processor` habilitado?
2. ¿Hay mensajes con `NextRetryAt` en el pasado?
3. Check logs del processor por errores
4. Verificar que `sp_GetDeadLettersForRetry` existe en SQL

## 9. Best Practices Summary

✅ **DO**:

- Usar correlation IDs en todas las operaciones
- Loguear con contexto estructurado
- Medir performance de operaciones críticas
- Configurar alertas para métricas clave
- Monitorear el DLQ regularmente

❌ **DON'T**:

- Loguear información sensible (passwords, tokens, etc.)
- Crear logs sin contexto ("Error processing")
- Ignorar alertas críticas
- Dejar mensajes en DLQ sin investigar

## 10. Referencias

- [Structured Logging Best Practices](https://www.honeycomb.io/blog/structured-logging-best-practices)
- [Distributed Tracing with Correlation IDs](https://www.elastic.co/guide/en/apm/guide/current/data-model-metadata.html)
- [SRE Monitoring Best Practices](https://sre.google/sre-book/monitoring-distributed-systems/)
