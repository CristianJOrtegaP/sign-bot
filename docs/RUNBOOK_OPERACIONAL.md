# AC FixBot - Runbook Operacional

Este documento contiene procedimientos para el manejo de incidentes comunes y operaciones de mantenimiento.

---

## 1. Incidentes Comunes

### 1.1 Error: "ECONNREFUSED" a Base de Datos

**Síntomas:**

- Logs: `Error: connect ECONNREFUSED`
- Health check reporta `database: unhealthy`
- Mensajes van a Dead Letter Queue
- Usuarios reciben "Ocurrió un error, intenta de nuevo"

**Diagnóstico:**

```bash
# Verificar estado del SQL Server en Azure Portal
az sql db show --name acfixbot-db --server acfixbot-sql --resource-group acfixbot-rg --query status

# Verificar firewall rules
az sql server firewall-rule list --server acfixbot-sql --resource-group acfixbot-rg

# Ver logs recientes de la Function App
az functionapp logs tail --name acfixbot-func --resource-group acfixbot-rg
```

**Solución:**

1. Verificar que Azure SQL no esté en mantenimiento (Azure Portal > SQL Database > Activity Log)
2. Verificar que la IP de Azure Functions esté en whitelist del firewall
3. Reiniciar connection pool: `POST /api/admin-cache?action=reconnect-db` (requiere API Key)
4. Si persiste más de 15 minutos, escalar a DBA

**Prevención:**

- Configurar alertas en Application Insights para errores de conexión
- Mantener firewall rules actualizadas si la IP de Functions cambia

---

### 1.2 Error: Rate Limit Excedido en WhatsApp

**Síntomas:**

- Logs: `WhatsApp API rate limit exceeded`
- Circuit breaker abierto para servicio `whatsapp`
- Mensajes no se envían a usuarios
- Health check muestra `circuitBreakers.whatsapp: OPEN`

**Diagnóstico:**

```bash
# Ver estado del health check
curl -H "x-api-key: <API_KEY>" https://acfixbot.azurewebsites.net/api/health

# Ver métricas de WhatsApp
curl -H "x-api-key: <API_KEY>" https://acfixbot.azurewebsites.net/api/metrics
```

**Solución:**

1. Esperar 5 minutos (el circuit breaker tiene cooldown automático)
2. Verificar que no hay spam de usuarios (revisar logs)
3. Si es tráfico legítimo:
   - Considerar aumentar rate limits en Meta Business Manager
   - Implementar cola de mensajes si no existe
4. Si es spam, identificar y bloquear usuario malicioso

**Prevención:**

- Monitorear métricas de envío de mensajes
- Configurar alertas cuando error rate > 5%

---

### 1.3 Mensajes en Dead Letter Queue

**Síntomas:**

- Alerta: "DLQ Overload" (más de 25 mensajes)
- Health check muestra `deadLetterQueue.pending > 0`
- Algunos usuarios no reciben respuesta

**Diagnóstico:**

```sql
-- Ver mensajes pendientes
SELECT TOP 10
    DeadLetterId, WhatsAppMessageId, Telefono, TipoMensaje,
    ErrorMessage, RetryCount, FechaCreacion
FROM DeadLetterMessages
WHERE Estado = 'PENDING'
ORDER BY FechaCreacion DESC;

-- Ver estadísticas por error
SELECT ErrorCode, COUNT(*) as Total
FROM DeadLetterMessages
WHERE Estado = 'PENDING'
GROUP BY ErrorCode
ORDER BY Total DESC;
```

**Solución:**

1. Revisar tipo de errores en los mensajes
2. Si es error transitorio (ECONNREFUSED, ETIMEDOUT):
   - Esperar retry automático (exponential backoff)
3. Si es error permanente (ValidationError, datos inválidos):
   ```sql
   -- Marcar como fallido permanente
   UPDATE DeadLetterMessages
   SET Estado = 'FAILED', FechaActualizacion = GETDATE()
   WHERE DeadLetterId IN (/* IDs específicos */);
   ```
4. Si hay muchos mensajes de un usuario específico, puede ser spam

**Limpieza automática:**
El sistema limpia mensajes procesados/fallidos mayores a 7 días automáticamente.

---

### 1.4 Error: AI Provider Timeout

**Síntomas:**

- Logs: `Timeout en detección de intent` o `AI unavailable`
- Circuit breaker abierto para `gemini` o `azure-openai`
- Respuestas genéricas a usuarios ("No entendí tu mensaje")

**Diagnóstico:**

```bash
# Ver estado de circuit breakers
curl -H "x-api-key: <API_KEY>" https://acfixbot.azurewebsites.net/api/health | jq '.checks.circuitBreakers'

# Ver métricas de AI
curl -H "x-api-key: <API_KEY>" https://acfixbot.azurewebsites.net/api/metrics | jq '.timings | with_entries(select(.key | startswith("ai.")))'
```

**Solución:**

1. Verificar estado del servicio AI en el portal correspondiente:
   - Google AI Studio (Gemini)
   - Azure Portal > Azure OpenAI
2. Verificar que las API keys son válidas y no han expirado
3. Esperar recuperación automática del circuit breaker (30 segundos)
4. El sistema tiene fallback a regex para intents comunes

**Prevención:**

- Monitorear latencia de AI en Application Insights
- Configurar alertas cuando p95 > 3 segundos

---

### 1.5 Error: Memoria Alta (>80%)

**Síntomas:**

- Alerta: "High Memory Usage"
- Health check muestra `memory.heapUsedPercent > 80%`
- Posible degradación de performance

**Diagnóstico:**

```bash
# Ver uso de memoria actual
curl -H "x-api-key: <API_KEY>" https://acfixbot.azurewebsites.net/api/health | jq '.checks.memory'
```

**Solución:**

1. Si es ocasional (< 90%), el garbage collector lo manejará
2. Si persiste > 90%:
   ```bash
   # Reiniciar la Function App
   az functionapp restart --name acfixbot-func --resource-group acfixbot-rg
   ```
3. Revisar si hay memory leaks en logs recientes
4. Considerar escalar el plan si el tráfico ha aumentado

**Prevención:**

- Rate limiter evita memory exhaustion por usuarios
- Límite máximo de 10,000 IPs en memoria

---

## 2. Procedimientos de Mantenimiento

### 2.1 Rollback de Deployment

```bash
# Listar deployments recientes
az functionapp deployment list --name acfixbot-func --resource-group acfixbot-rg --output table

# Ver historial de slots (si hay staging)
az functionapp deployment slot list --name acfixbot-func --resource-group acfixbot-rg

# Rollback usando slot swap (si staging configurado)
az functionapp deployment slot swap --name acfixbot-func --resource-group acfixbot-rg --slot staging

# Rollback usando deployment source sync
az functionapp deployment source sync --name acfixbot-func --resource-group acfixbot-rg
```

### 2.2 Desactivar Funcionalidad Temporalmente

```bash
# Desactivar IA (usar solo regex)
az functionapp config appsettings set --name acfixbot-func --resource-group acfixbot-rg --settings USE_AI=false

# Desactivar transcripción de audio
az functionapp config appsettings set --name acfixbot-func --resource-group acfixbot-rg --settings AUDIO_TRANSCRIPTION_ENABLED=false

# Desactivar procesamiento de imágenes
az functionapp config appsettings set --name acfixbot-func --resource-group acfixbot-rg --settings VISION_ENABLED=false

# NOTA: Cambios de app settings reinician la Function App automáticamente
```

### 2.3 Limpiar Caché Manualmente

```bash
# Limpiar caché de sesiones
curl -X POST -H "x-api-key: <API_KEY>" \
  "https://acfixbot.azurewebsites.net/api/admin-cache?action=clear&type=sessions"

# Limpiar caché de equipos
curl -X POST -H "x-api-key: <API_KEY>" \
  "https://acfixbot.azurewebsites.net/api/admin-cache?action=clear&type=equipos"

# Limpiar todo el caché
curl -X POST -H "x-api-key: <API_KEY>" \
  "https://acfixbot.azurewebsites.net/api/admin-cache?action=clear&type=all"
```

### 2.4 Forzar Timeout de Sesiones

```bash
# Forzar timeout de todas las sesiones inactivas
curl -X POST -H "x-api-key: <API_KEY>" \
  "https://acfixbot.azurewebsites.net/api/admin-timeout"
```

---

## 3. Monitoreo

### 3.1 Dashboards

| Dashboard            | URL                                             | Descripción             |
| -------------------- | ----------------------------------------------- | ----------------------- |
| Application Insights | Azure Portal > AC FixBot > Application Insights | Telemetría completa     |
| Live Metrics         | Application Insights > Live Metrics             | Métricas en tiempo real |
| Failures             | Application Insights > Failures                 | Análisis de errores     |
| Health Endpoint      | `/api/health`                                   | Estado de componentes   |
| Metrics Endpoint     | `/api/metrics`                                  | Métricas agregadas      |

### 3.2 Alertas Configuradas

| Alerta          | Condición          | Severidad | Acción                     |
| --------------- | ------------------ | --------- | -------------------------- |
| Error Rate High | > 10% en 5 min     | CRITICAL  | Investigar inmediatamente  |
| SLA Breach      | Compliance < 90%   | CRITICAL  | Revisar latencias          |
| High Memory     | > 90% heap         | CRITICAL  | Considerar restart         |
| DLQ Overload    | > 25 mensajes      | WARNING   | Revisar mensajes fallidos  |
| Circuit Open    | Cualquier servicio | WARNING   | Verificar servicio externo |

### 3.3 Queries Útiles en Application Insights (KQL)

```kql
// Errores en última hora
exceptions
| where timestamp > ago(1h)
| summarize count() by outerMessage
| order by count_ desc
| take 10

// Latencia de operaciones
customMetrics
| where name endswith ".duration"
| where timestamp > ago(1h)
| summarize avg(value), percentile(value, 95) by name
| order by avg_value desc

// Mensajes por tipo
customEvents
| where name == "WebhookReceived"
| where timestamp > ago(24h)
| summarize count() by tostring(customDimensions.messageType)
```

---

## 4. Contactos de Escalación

| Nivel | Rol                      | Tiempo Respuesta |
| ----- | ------------------------ | ---------------- |
| L1    | DevOps On-Call           | 15 minutos       |
| L2    | Tech Lead Backend        | 30 minutos       |
| L3    | Arquitecto de Soluciones | 1 hora           |
| L4    | Product Owner            | 2 horas          |

### Criterios de Escalación:

- **L1 → L2**: Incidente no resuelto en 30 minutos
- **L2 → L3**: Requiere cambios de arquitectura o decisiones de diseño
- **L3 → L4**: Impacto en negocio o decisiones que afectan SLA

---

## 5. Checklist Post-Incidente

- [ ] Incidente documentado en sistema de tickets
- [ ] Root cause identificado
- [ ] Métricas de impacto recopiladas (usuarios afectados, duración)
- [ ] Acciones correctivas definidas
- [ ] Alertas/monitoreo ajustado si es necesario
- [ ] Post-mortem agendado (para incidentes críticos)
- [ ] Comunicación a stakeholders completada
