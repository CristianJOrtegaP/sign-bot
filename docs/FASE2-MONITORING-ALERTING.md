# FASE 2: Monitoring y Alerting

## Resumen

FASE 2 agrega capacidades enterprise-grade de monitoring, alerting y observability al sistema AC FixBot.

## Features Implementadas

### 1. Enhanced Metrics & Monitoring

**Archivo**: `core/services/infrastructure/metricsService.js`

**Features**:

- **Percentiles (p50, p75, p95, p99)**: Mejor comprensión de la distribución de latencias
- **Latency Histograms**: Distribución de latencias en buckets (<50ms, 50-100ms, etc.)
- **SLA Tracking**: % de operaciones dentro del target SLA
- **Error Rates**: Tasa de errores por operación
- **Throughput**: Operaciones por segundo

**SLA Targets Configurados**:

```javascript
{
  'webhook.process': 1000ms,
  'ai.generateResponse': 3000ms,
  'db.query': 500ms,
  'whatsapp.sendMessage': 2000ms,
  'default': 2000ms
}
```

**Uso**:

```javascript
const timer = metricsService.startTimer('webhook.process', context);
try {
  await processMessage(message);
  timer.end({ success: true });
} catch (error) {
  timer.end({ error: true });
  throw error;
}
```

**Ver Métricas**:

```bash
GET /api/metrics
Authorization: Bearer <ADMIN_API_KEY>

# Respuesta incluye:
# - percentiles (p50, p75, p95, p99)
# - latencyHistograms por operación
# - slaCompliance con % compliance
# - errorRates por operación
```

### 2. Metrics Dashboard API

**Endpoint**: `api-metrics/index.js`

**Features**:

- Endpoint HTTP GET protegido con API key
- Visualización de métricas en tiempo real
- Métricas históricas desde Azure Table Storage
- Filtrado por operación específica

**Endpoints**:

```bash
# Real-time metrics
GET /api/metrics

# Filtrar por operación
GET /api/metrics?operation=webhook.process

# Métricas históricas
GET /api/metrics?historical=true&date=2025-01-15
```

**Autenticación**:

```bash
# Header
x-api-key: <ADMIN_API_KEY>

# O query param
?apiKey=<ADMIN_API_KEY>
```

### 3. Enhanced Health Checks

**Archivo**: `api-health/index.js`

**Mejoras**:

- **Database**: Verifica tablas críticas + pool stats (no solo SELECT 1)
- **WhatsApp API**: Request real a Meta API para verificar conectividad
- **AI Provider**: Verifica que Gemini/Azure OpenAI responda
- **Metrics Service**: Estado del sistema de métricas
- **Estado "degraded"**: Nuevo estado intermedio entre healthy y unhealthy

**Checks Activos**:

```javascript
// WhatsApp API - Request real
GET https://graph.facebook.com/v21.0/{phone_id}

// AI Provider - Test simple
POST https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent

// Database - Verificar tablas
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME IN (...)
```

**Respuesta**:

```json
{
  "status": "healthy",
  "checks": {
    "database": {
      "status": "healthy",
      "details": {
        "tablesFound": 4,
        "poolStats": { "size": 5, "available": 4 }
      }
    },
    "whatsappApi": {
      "status": "healthy",
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

### 4. Alerting System

**Archivo**: `core/services/infrastructure/alertingService.js`

**Features**:

- **Thresholds configurables** por métrica
- **Webhooks** para notificaciones (Slack, Teams, custom)
- **Alert aggregation** (5 min cooldown para evitar spam)
- **Severidades**: INFO, WARNING, ERROR, CRITICAL
- **Evaluación automática** cada 60s junto con métricas

**Thresholds Configurados**:

```javascript
{
  errorRate: { warning: 5%, critical: 10% },
  slaCompliance: { warning: 95%, critical: 90% },
  memoryUsage: { warning: 80%, critical: 90% },
  deadLetterQueue: { warning: 10, critical: 25 }
}
```

**Configuración**:

```bash
# .env o local.settings.json
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/T00/B00/xxx
```

**Alertas Automáticas**:

- Error rate excede threshold
- SLA compliance cae por debajo del threshold
- Latencia p95 excede el límite
- Uso de memoria >90%
- DLQ con muchos mensajes fallidos
- Sistema unhealthy o degraded

**Enviar Alerta Manual**:

```javascript
const alertingService = require('../core/services/infrastructure/alertingService');

await alertingService.sendManualAlert('CRITICAL', 'custom_error', 'Descripción del problema', {
  context: 'details',
});
```

**Formato Webhook (Slack)**:

```json
{
  "text": "🚨 CRITICAL: Error rate crítico en webhook.process: 12.00%",
  "attachments": [
    {
      "color": "danger",
      "fields": [
        { "title": "Type", "value": "error_rate" },
        { "title": "operation", "value": "webhook.process" },
        { "title": "errorRate", "value": "12.00%" },
        { "title": "threshold", "value": "10%" }
      ]
    }
  ]
}
```

### 5. Dead Letter Queue Processor

**Archivos**: `timer-dlq-processor/`

**Features**:

- **Timer Trigger**: Se ejecuta cada 10 minutos automáticamente
- **Reprocessing automático**: Intenta reprocesar mensajes fallidos
- **Exponential backoff**: 1min, 5min, 15min entre reintentos
- **Estado tracking**: PENDING → RETRYING → PROCESSED/FAILED
- **Alertas automáticas**: Cuando hay mensajes fallidos permanentemente
- **Cleanup automático**: Elimina mensajes antiguos (>7 días)

**Schedule**: `0 */10 * * * *` (cada 10 minutos)

**Configuración**:

```bash
DLQ_CLEANUP_DAYS=7  # Días a mantener mensajes antiguos
```

**Flujo**:

```
1. Obtiene mensajes con NextRetryAt <= NOW
2. Intenta reprocesar cada mensaje (timeout 30s)
3. Si éxito → markAsProcessed()
4. Si fallo → recordRetryFailure() (incrementa RetryCount)
5. Si RetryCount >= MaxRetries → Estado = FAILED
6. Envía alertas si hay mensajes FAILED
7. Cleanup mensajes antiguos
```

**Logs**:

```
🔄 [DLQ Processor] Iniciando procesamiento
[DLQ] Estadísticas: total=15, pending=5, failed=2
[DLQ] Reprocesando mensaje wamid.123
✅ [DLQ Processor] Completado: processed=3, failed=1, permanentlyFailed=1
```

### 6. Observability Enhancements

**Documentación**: `docs/observability-guide.md`

**Conceptos**:

- **Structured Logging**: Logs con contexto estructurado (JSON)
- **Distributed Tracing**: Correlation IDs en todas las operaciones
- **Performance Tracking**: Timers automáticos para operaciones críticas

**Mejores Prácticas**:

```javascript
// ✅ Bueno - Structured logging con contexto
logger.info('Mensaje procesado', {
  messageId: 'wamid.123',
  telefono: '+5215512345678',
  duration_ms: 245,
  success: true,
});

// ❌ Malo - Sin contexto
logger.info('Mensaje procesado');
```

**Correlation IDs**:

```javascript
const correlation = require('../core/services/infrastructure/correlationService');

// En Azure Function handlers
correlation.initContext();
const correlationId = correlation.getCorrelationId();

// Buscar en logs
traces
| where customDimensions.correlationId == "abc-123"
| order by timestamp asc
```

## Tests

### Tests Unitarios Creados

1. **Enhanced Metrics** (`tests/unit/enhancedMetrics.test.js`):
   - Percentiles calculation
   - Latency histograms
   - SLA tracking
   - Error rates

2. **Alerting System** (`tests/unit/alertingSystem.test.js`):
   - Alert creation
   - Threshold evaluation
   - Alert aggregation (cooldown)
   - Webhook notifications
   - Metrics evaluation
   - Health check evaluation

### Ejecutar Tests

```bash
# Solo tests de FASE 2
npx jest tests/unit/enhancedMetrics.test.js
npx jest tests/unit/alertingSystem.test.js

# Todos los tests
npm test

# Con coverage
npm run test:coverage
```

## Variables de Entorno Nuevas

```bash
# Alerting
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...

# API Authentication
ADMIN_API_KEY=your_secure_api_key_here

# DLQ Processor
DLQ_CLEANUP_DAYS=7
```

## Endpoints Nuevos

```
GET  /api/metrics              - Métricas dashboard (requiere API key)
GET  /api/metrics?operation=X  - Métricas de operación específica
GET  /api/metrics?historical=true&date=YYYY-MM-DD  - Métricas históricas
GET  /api/health               - Enhanced health checks
```

## Archivos Nuevos

```
api-metrics/
  ├── function.json              # Config Azure Function
  └── index.js                   # Metrics Dashboard API

timer-dlq-processor/
  ├── function.json              # Timer config (cada 10min)
  └── index.js                   # DLQ Processor logic

core/services/infrastructure/
  └── alertingService.js         # Sistema de alertas

docs/
  ├── FASE2-MONITORING-ALERTING.md  # Este documento
  └── observability-guide.md     # Guía de observability

tests/unit/
  ├── enhancedMetrics.test.js    # Tests de metrics
  └── alertingSystem.test.js     # Tests de alerting
```

## Archivos Modificados

```
core/services/infrastructure/
  └── metricsService.js          # + Enhanced metrics, alerting integration

api-health/
  └── index.js                   # + Active health checks
```

## Integración con Azure

### Application Insights

Las métricas y logs se integran automáticamente con Azure Application Insights:

```kusto
// Ver métricas en tiempo real
customMetrics
| where name startswith "acfixbot"
| summarize avg(value) by name, bin(timestamp, 5m)

// Ver alertas enviadas
traces
| where message contains "[ALERT]"
| order by timestamp desc

// SLA compliance
traces
| where message contains "[METRICS]"
| extend duration = todouble(customDimensions.duration_ms)
| summarize
    within=countif(duration <= 1000),
    total=count()
| extend compliance=(within * 100.0) / total
```

### Azure Monitor Alerts

Puedes configurar Azure Monitor alerts basadas en:

- Custom metrics de metricsService
- Logs de alertingService
- Health check failures

## Próximos Pasos

1. **Ejecutar tests localmente**:

   ```bash
   npm test
   ```

2. **Configurar webhook de Slack/Teams**:

   ```bash
   # En local.settings.json
   "ALERT_WEBHOOK_URL": "https://hooks.slack.com/services/..."
   ```

3. **Probar endpoints de métricas**:

   ```bash
   curl http://localhost:7071/api/metrics \
     -H "x-api-key: mi_api_key_admin_dev"
   ```

4. **Monitorear DLQ Processor**:

   ```bash
   # Ver logs del timer
   func start
   # Se ejecuta cada 10 minutos automáticamente
   ```

5. **Deploy a Azure**:

   ```bash
   # Configurar secrets en GitHub
   AZURE_CREDENTIALS_STAGING
   AZURE_CREDENTIALS_PRODUCTION

   # Push para trigger CI/CD
   git push origin main
   ```

## Métricas Clave a Monitorear

- **Error Rate**: <5% (warning si >5%, critical si >10%)
- **SLA Compliance**: >95% (warning si <95%, critical si <90%)
- **P95 Latency**: <threshold por operación
- **Memory Usage**: <80% (warning si >80%, critical si >90%)
- **DLQ Size**: <10 mensajes (warning si >10, critical si >25)
- **Health Status**: healthy (alert si degraded o unhealthy)

## Troubleshooting

Ver [Observability Guide](./observability-guide.md#8-troubleshooting) para guía completa de troubleshooting.

## Referencias

- [Observability Guide](./observability-guide.md)
- [SRE Monitoring Best Practices](https://sre.google/sre-book/monitoring-distributed-systems/)
- [OpenTelemetry](https://opentelemetry.io/)
