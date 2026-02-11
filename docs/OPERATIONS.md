# Operaciones y Mantenimiento — Sign Bot

> Audiencia: SRE, DevOps, Operaciones
> Última actualización: Febrero 2026

---

## Tabla de Contenidos

1. [Azure Functions Timers](#azure-functions-timers)
2. [Monitoreo con Application Insights](#monitoreo-con-application-insights)
3. [Dead Letter Queue (DLQ)](#dead-letter-queue-dlq)
4. [Base de Datos — Mantenimiento](#base-de-datos--mantenimiento)
5. [Cache — Operaciones](#cache--operaciones)
6. [Procedimientos de Recuperación](#procedimientos-de-recuperación)
7. [Alertas Recomendadas](#alertas-recomendadas)

---

## Azure Functions Timers

Sign Bot tiene 3 timers que se ejecutan automáticamente. Todos están configurados en `host.json` con un timeout global de 5 minutos.

### timer-session-cleanup

**Archivo:** `timer-session-cleanup/index.js`
**Schedule:** `0 */5 * * * *` (cada 5 minutos)
**Variable:** `TIMER_SCHEDULE`

**Propósito:** Detectar sesiones inactivas y cerrarlas en dos fases.

```
Fase 1: Advertencia (5 min antes del timeout)
─────────────────────────────────────────────
Consulta: sp_GetSesionesNeedingWarning
Condición: inactividad >= (SESSION_TIMEOUT_MINUTES - SESSION_WARNING_MINUTES)
           AND AdvertenciaEnviada = 0
Acción:
  1. Enviar mensaje "¿Sigues ahí? Tu sesión se cerrará pronto"
  2. UPDATE AdvertenciaEnviada = 1, FechaAdvertencia = GETUTCDATE()

Fase 2: Cierre
──────────────
Consulta: sp_GetSesionesToClose
Condición: inactividad >= SESSION_TIMEOUT_MINUTES
           AND AdvertenciaEnviada = 1
Acción:
  1. Enviar mensaje "Sesión cerrada por inactividad"
  2. UPDATE EstadoId = TIMEOUT (4)
  3. Registrar en HistorialSesiones (OrigenAccion = 'TIMER')
```

**Configuración por defecto:**

| Parámetro           | Valor                | Variable                  |
| ------------------- | -------------------- | ------------------------- |
| Timeout total       | 30 min               | `SESSION_TIMEOUT_MINUTES` |
| Advertencia         | 25 min (5 min antes) | `SESSION_WARNING_MINUTES` |
| Frecuencia de check | Cada 5 min           | `TIMER_SCHEDULE`          |

**Validación:** `SESSION_WARNING_MINUTES` debe ser menor que `SESSION_TIMEOUT_MINUTES`.

---

### timer-survey-sender

**Archivo:** `timer-survey-sender/index.js`
**Schedule:** `0 0 9 * * *` (9:00 AM diario)
**Variable:** `SURVEY_TIMER_SCHEDULE`

**Propósito:** Enviar encuestas de satisfacción a usuarios cuyos reportes fueron resueltos.

```
Proceso:
────────
1. Verificar ventana horaria (SURVEY_HORA_INICIO a SURVEY_HORA_FIN)
   └── Si fuera de horario → skip

2. Expirar encuestas sin respuesta (> SURVEY_HORAS_EXPIRACION)
   └── sp_ExpirarEncuestasSinRespuesta

3. Consultar reportes elegibles
   └── sp_GetReportesPendientesEncuesta(SURVEY_HORAS_ESPERA)
   Condiciones:
     ├── FechaResolucion > SURVEY_HORAS_ESPERA horas
     ├── No tiene encuesta existente para ese reporte
     ├── No tiene sesión activa en ese momento
     └── Límite: 50 reportes por ejecución

4. Para cada reporte elegible:
   a. Crear registro en tabla Encuestas
      └── Si ya existe → retorna null (idempotente)
   b. Crear sesión o actualizar estado a ENCUESTA_INVITACION
   c. Enviar invitación por WhatsApp (botones: Sí/No)
   d. Pausa de 1 segundo entre envíos (rate limiting)

5. Registrar métricas:
   └── Total enviadas, errores, tiempo de ejecución
```

**Configuración:**

| Parámetro              | Valor          | Variable                  |
| ---------------------- | -------------- | ------------------------- |
| Horas post-resolución  | 24h            | `SURVEY_HORAS_ESPERA`     |
| Expiración de encuesta | 72h            | `SURVEY_HORAS_EXPIRACION` |
| Ventana horaria inicio | 8:00 AM        | `SURVEY_HORA_INICIO`      |
| Ventana horaria fin    | 8:00 PM        | `SURVEY_HORA_FIN`         |
| Zona horaria           | UTC-6 (México) | `TIMEZONE_OFFSET_HOURS`   |
| Máximo por ejecución   | 50             | Hardcoded                 |
| Pausa entre envíos     | 1 segundo      | Hardcoded                 |

**Preguntas de la encuesta:** Se definen dinámicamente por `TipoEncuestaId` en la tabla `PreguntasEncuesta`. Escala 1-5 con botones interactivos.

---

### timer-dlq-processor

**Archivo:** `timer-dlq-processor/index.js`
**Schedule:** Configurable (ver sección DLQ)

**Propósito:** Reprocesar mensajes que fallaron durante el procesamiento original.

```
Proceso:
────────
1. Consultar: sp_GetDeadLettersForRetry
   Condiciones:
     ├── Procesado = 0
     ├── FechaProces < 24 horas
     └── Ordenado por más antiguo primero

2. Para cada mensaje:
   a. Reconstruir payload del mensaje original
   b. Reprocesar a través del handler correspondiente
   c. Si éxito → UPDATE Procesado = 1
   d. Si falla → UPDATE FechaProces = GETUTCDATE() (retry en siguiente ciclo)

3. Limpieza: sp_CleanOldDeadLetters
   └── Eliminar registros > 30 días (procesados o no)
```

---

## Monitoreo con Application Insights

**SDK:** `applicationinsights` v3.4.0
**Feature:** W3C Distributed Tracing habilitado

### Queries KQL Esenciales

#### Mensajes procesados por hora

```kql
customEvents
| where name == "MessageProcessed"
| where timestamp > ago(24h)
| summarize count() by bin(timestamp, 1h), tostring(customDimensions.messageType)
| render timechart
```

#### Tasa de error del webhook

```kql
requests
| where name == "POST /api/whatsapp-webhook"
| where timestamp > ago(24h)
| summarize
    total = count(),
    errors = countif(resultCode >= 500),
    errorRate = round(100.0 * countif(resultCode >= 500) / count(), 2)
| project total, errors, errorRate
```

#### Latencia del webhook (percentiles)

```kql
requests
| where name == "POST /api/whatsapp-webhook"
| where timestamp > ago(24h)
| summarize
    p50 = percentile(duration, 50),
    p90 = percentile(duration, 90),
    p95 = percentile(duration, 95),
    p99 = percentile(duration, 99)
```

#### Consumo de tokens de IA

```kql
customEvents
| where name == "AITokenUsage"
| where timestamp > ago(7d)
| summarize
    totalPromptTokens = sum(toint(customDimensions.promptTokens)),
    totalCompletionTokens = sum(toint(customDimensions.completionTokens)),
    totalCalls = count()
| extend estimatedCost = (totalPromptTokens * 0.00015 + totalCompletionTokens * 0.0006) / 1000
```

#### Detección de intención — distribución

```kql
customEvents
| where name == "IntentDetected"
| where timestamp > ago(24h)
| summarize count() by tostring(customDimensions.intent), tostring(customDimensions.tier)
| order by count_ desc
```

#### Sesiones cerradas por timeout

```kql
customEvents
| where name == "SessionTimeout"
| where timestamp > ago(7d)
| summarize count() by bin(timestamp, 1d)
| render barchart
```

#### Reportes creados por tipo

```kql
customEvents
| where name == "ReportCreated"
| where timestamp > ago(30d)
| summarize count() by bin(timestamp, 1d), tostring(customDimensions.reportType)
| render timechart
```

#### Dead Letters — mensajes fallidos

```kql
customEvents
| where name == "DeadLetterCreated"
| where timestamp > ago(7d)
| summarize count() by bin(timestamp, 1h), tostring(customDimensions.errorType)
| render timechart
```

#### Encuestas — tasa de completación

```kql
customEvents
| where name in ("SurveySent", "SurveyCompleted", "SurveyExpired")
| where timestamp > ago(30d)
| summarize count() by name
| render piechart
```

#### Errores de bloqueo optimista

```kql
customEvents
| where name == "OptimisticLockConflict"
| where timestamp > ago(24h)
| summarize count() by bin(timestamp, 1h)
| render timechart
```

#### Circuit breaker — activaciones

```kql
customEvents
| where name == "CircuitBreakerOpen"
| where timestamp > ago(7d)
| project timestamp, tostring(customDimensions.service), tostring(customDimensions.failureCount)
| order by timestamp desc
```

#### Top 10 errores recientes

```kql
exceptions
| where timestamp > ago(24h)
| summarize count() by type, outerMessage
| top 10 by count_
```

---

## Dead Letter Queue (DLQ)

### Arquitectura

Cuando un mensaje falla durante el procesamiento, se envía a la DLQ en lugar de perderse:

```
Webhook recibe mensaje
        │
   Procesamiento
        │
    ¿Error?
     │    │
    No   Sí ──▶ INSERT INTO DeadLetterMessages
     │          (MensajeId, Telefono, Tipo, Contenido,
     │           ErrorMensaje, Procesado=0)
     │
  Respuesta OK          timer-dlq-processor
  (siempre 200)    ──────────▶  Reintento
                               automático
```

### Tabla DeadLetterMessages

```sql
CREATE TABLE DeadLetterMessages (
    Id              INT IDENTITY PRIMARY KEY,
    MensajeId       NVARCHAR(100) NOT NULL UNIQUE,
    Telefono        NVARCHAR(20),
    Tipo            NVARCHAR(20),     -- text, image, audio, interactive
    Contenido       NVARCHAR(MAX),    -- Payload original serializado
    ErrorMensaje    NVARCHAR(MAX),    -- Stack trace del error
    Procesado       BIT DEFAULT 0,    -- 0=pendiente, 1=procesado
    FechaCreacion   DATETIME2 DEFAULT GETUTCDATE(),
    FechaProces     DATETIME2         -- Último intento de reproceso
);
```

### Consultar mensajes fallidos (manual)

```sql
-- Mensajes pendientes de reintento
SELECT Id, MensajeId, Telefono, Tipo, ErrorMensaje, FechaCreacion
FROM DeadLetterMessages
WHERE Procesado = 0
ORDER BY FechaCreacion DESC;

-- Conteo por tipo de error
SELECT
    LEFT(ErrorMensaje, 100) AS ErrorResumido,
    COUNT(*) AS Total
FROM DeadLetterMessages
WHERE Procesado = 0
GROUP BY LEFT(ErrorMensaje, 100)
ORDER BY Total DESC;
```

### Reprocesar manualmente

```sql
-- Marcar como no procesado para que el timer lo reintente
UPDATE DeadLetterMessages
SET Procesado = 0, FechaProces = NULL
WHERE Id = @id;
```

---

## Base de Datos — Mantenimiento

### Índices Críticos

Estos índices son esenciales para el rendimiento a 3,000 reportes/mes:

```sql
-- Bloqueo optimista: lookup por teléfono + versión
IX_SesionesChat_Telefono_Version    ON SesionesChat(Telefono, Version)

-- Timer session-cleanup: sesiones inactivas
IX_SesionesChat_UltimaActividad     ON SesionesChat(UltimaActividad)

-- Timer survey-sender: reportes resueltos sin encuesta
IX_Reportes_FechaResolucion         ON Reportes(FechaResolucion)

-- Lookup de tickets: consulta de estado
IX_Reportes_NumeroTicket            ON Reportes(NumeroTicket)

-- Búsqueda geográfica: centro más cercano
IX_CentrosServicio_Ubicacion        ON CentrosServicio(Latitud, Longitud)

-- Historial de reportes por teléfono
IX_Reportes_TelefonoReportante      ON Reportes(TelefonoReportante)

-- Deduplicación: lookup de mensajes procesados
IX_MensajesProcessados_MensajeId    ON MensajesProcessados(MensajeId) UNIQUE
```

### Mantenimiento Periódico

#### Limpieza de MensajesProcessados (semanal)

```sql
-- Eliminar registros de deduplicación > 7 días
DELETE FROM MensajesProcessados
WHERE FechaProces < DATEADD(DAY, -7, GETUTCDATE());
```

#### Limpieza de HistorialSesiones (mensual)

```sql
-- Eliminar auditoría > 3 meses
DELETE FROM HistorialSesiones
WHERE FechaCreacion < DATEADD(MONTH, -3, GETUTCDATE());
```

#### Limpieza de MensajesChat (trimestral)

```sql
-- Archivar mensajes > 6 meses (considerar exportar antes)
DELETE FROM MensajesChat
WHERE FechaCreacion < DATEADD(MONTH, -6, GETUTCDATE());
```

#### Estadísticas de índices

```sql
-- Ver fragmentación de índices
SELECT
    OBJECT_NAME(ips.object_id) AS TableName,
    i.name AS IndexName,
    ips.avg_fragmentation_in_percent
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
JOIN sys.indexes i ON ips.object_id = i.object_id AND ips.index_id = i.index_id
WHERE ips.avg_fragmentation_in_percent > 30
ORDER BY ips.avg_fragmentation_in_percent DESC;

-- Rebuild si fragmentación > 30%
ALTER INDEX IX_SesionesChat_Telefono_Version ON SesionesChat REBUILD;
```

### Consistencia de Datos

Con 3,000 reportes/mes, es crítico verificar la consistencia periódicamente:

```sql
-- Sesiones huérfanas (estado activo pero sin actividad reciente)
SELECT Telefono, EstadoId, UltimaActividad,
       DATEDIFF(MINUTE, UltimaActividad, GETUTCDATE()) AS MinutosInactiva
FROM SesionesChat
WHERE EstadoId NOT IN (1, 2, 3, 4)  -- No terminal
  AND DATEDIFF(HOUR, UltimaActividad, GETUTCDATE()) > 2;

-- Reportes sin ticket asignado
SELECT Id, TelefonoReportante, FechaCreacion
FROM Reportes
WHERE NumeroTicket IS NULL
  AND FechaCreacion < DATEADD(HOUR, -1, GETUTCDATE());

-- Encuestas expiradas no marcadas
SELECT e.Id, e.TelefonoReportante, e.FechaCreacion, e.FechaExpiracion
FROM Encuestas e
JOIN CatEstadoEncuesta ce ON e.EstadoEncuestaId = ce.Id
WHERE ce.Nombre = 'ENVIADA'
  AND e.FechaExpiracion < GETUTCDATE();
```

---

## Cache — Operaciones

### Verificar Estado del Cache

```bash
# Via API admin (requiere Function Key)
curl -H "x-functions-key: <key>" \
  https://<function-app>.azurewebsites.net/api/admin/cache/stats
```

**Respuesta:**

```json
{
  "redis": {
    "enabled": true,
    "connected": true,
    "usingFallback": false,
    "latencyMs": 3
  },
  "local": {
    "entries": 142,
    "maxEntries": 10000
  }
}
```

### Limpiar Cache

```bash
# Limpiar todo el cache (Redis + local)
curl -X POST -H "x-functions-key: <key>" \
  https://<function-app>.azurewebsites.net/api/admin/cache/clear
```

**Cuándo limpiar cache:**

- Después de actualizar datos de catálogo (Equipos, CentrosServicio)
- Si se detectan datos inconsistentes entre cache y BD
- Después de cambios en la tabla CatEstadoSesion

### Monitorear Redis (Azure Portal)

Métricas clave en Azure Cache for Redis:

| Métrica             | Umbral de alerta | Acción                     |
| ------------------- | ---------------- | -------------------------- |
| Used Memory         | > 80%            | Considerar upgrade de tier |
| Cache Hits / Misses | Ratio < 70%      | Revisar TTLs               |
| Connected Clients   | > 100            | Posible connection leak    |
| Server Load         | > 70%            | Scale up                   |

---

## Procedimientos de Recuperación

### Escenario 1: Webhook no responde

**Síntomas:** Meta reporta webhook unreachable, usuarios no reciben respuestas.

```
1. Verificar estado de la Function App:
   az functionapp show --name func-signbot-prod --query "state"

2. Verificar health check:
   curl https://<function-app>.azurewebsites.net/api/health

3. Si health check falla → verificar SQL:
   - ¿Connection pool agotado?
   - ¿Azure SQL disponible?
   - Revisar: az sql db show --name db-signbot ...

4. Reiniciar Function App (último recurso):
   az functionapp restart --name func-signbot-prod
```

### Escenario 2: Bloqueos optimistas frecuentes

**Síntomas:** Logs muestran `OptimisticLockConflict` > 10/hora.

```
1. Verificar mensajes duplicados:
   SELECT MensajeId, ContadorReintentos
   FROM MensajesProcessados
   WHERE ContadorReintentos > 1
     AND FechaProces > DATEADD(HOUR, -1, GETUTCDATE());

2. Si hay muchos duplicados:
   → Meta está reenviando agresivamente
   → Verificar que el webhook responde 200 OK rápido (< 5s)

3. Si no hay duplicados:
   → Background processor y webhook compiten
   → Esto es esperado a baja frecuencia
   → El sistema reintenta automáticamente
```

### Escenario 3: DLQ acumulando mensajes

**Síntomas:** Mensajes en DeadLetterMessages crecen sin procesarse.

```
1. Verificar tipo de error predominante:
   SELECT TOP 5 LEFT(ErrorMensaje, 200), COUNT(*)
   FROM DeadLetterMessages
   WHERE Procesado = 0
   GROUP BY LEFT(ErrorMensaje, 200)
   ORDER BY COUNT(*) DESC;

2. Si es error de conexión a DB:
   → Verificar SQL Server y connection pool
   → Reiniciar Function App

3. Si es error de WhatsApp API (429/5xx):
   → Rate limit de Meta → esperar
   → Circuit breaker debería activarse

4. Reprocesar manualmente si es necesario:
   UPDATE DeadLetterMessages
   SET Procesado = 0, FechaProces = NULL
   WHERE Procesado = 0
     AND FechaCreacion > DATEADD(DAY, -1, GETUTCDATE());
```

### Escenario 4: Redis no disponible

**Síntomas:** Health check reporta `redis.usingFallback: true`.

```
1. El sistema sigue funcionando con cache local (Map)
   → No hay pérdida de funcionalidad
   → Puede haber mayor latencia en intenciones AI

2. Verificar Azure Redis:
   az redis show --name redis-signbot --query "provisioningState"

3. Si Redis vuelve:
   → Reconexión automática (max 3 retries)
   → Cache local se sigue usando como L1

4. Si Redis está down por mucho tiempo:
   → Monitorear memoria de la Function App
   → Cache local tiene límite de 10,000 entries con LRU
```

### Escenario 5: Encuestas no se envían

**Síntomas:** No se crean encuestas nuevas después de las 9:00 AM.

```
1. Verificar que el timer se ejecutó:
   -- KQL
   traces
   | where message contains "survey-sender"
   | where timestamp > ago(24h)
   | order by timestamp desc

2. Verificar ventana horaria:
   → ¿TIMEZONE_OFFSET_HOURS es correcto? (default: -6)
   → ¿Hora actual está entre SURVEY_HORA_INICIO y SURVEY_HORA_FIN?

3. Verificar reportes elegibles:
   EXEC sp_GetReportesPendientesEncuesta @minutosEspera = 1440;
   -- Si retorna 0 → no hay reportes resueltos hace > 24h

4. Verificar que los reportes tengan FechaResolucion:
   SELECT COUNT(*) FROM Reportes
   WHERE EstadoReporteId = (SELECT Id FROM CatEstadoReporte WHERE Nombre = 'RESUELTO')
     AND FechaResolucion IS NOT NULL
     AND FechaResolucion > DATEADD(DAY, -7, GETUTCDATE());
```

---

## Alertas Recomendadas

### Configurar en Application Insights → Alerts

| Alerta                      | Condición                                        | Severidad       | Acción            |
| --------------------------- | ------------------------------------------------ | --------------- | ----------------- |
| **Webhook down**            | `requests` con `resultCode >= 500` > 10 en 5 min | Sev 1 (Crítica) | PagerDuty / Teams |
| **Latencia alta**           | P95 de webhook > 4,000 ms en 15 min              | Sev 2 (Alta)    | Teams             |
| **DLQ creciendo**           | `DeadLetterCreated` > 20 en 1 hora               | Sev 2 (Alta)    | Teams             |
| **Circuit breaker abierto** | `CircuitBreakerOpen` > 0 en 5 min                | Sev 2 (Alta)    | Teams             |
| **Bloqueo optimista**       | `OptimisticLockConflict` > 50 en 1 hora          | Sev 3 (Media)   | Email             |
| **Redis fallback**          | `redis.usingFallback = true` por > 10 min        | Sev 3 (Media)   | Email             |
| **Timer no ejecutado**      | Ausencia de trace de timer por > 2x schedule     | Sev 2 (Alta)    | Teams             |
| **AI tokens altos**         | `totalTokens` > 100,000 en 24h                   | Sev 4 (Info)    | Email             |

### Webhook de Alertas

Configurar `ALERT_WEBHOOK_URL` para notificaciones a Slack o Teams:

```
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXX
```

---

## Checklist de Operaciones Diarias

- [ ] Verificar health check: `GET /api/health`
- [ ] Revisar DLQ: ¿hay mensajes sin procesar?
- [ ] Verificar que timer-session-cleanup ejecutó (logs)
- [ ] Verificar que timer-survey-sender ejecutó a las 9:00 AM

## Checklist Semanal

- [ ] Revisar métricas de Application Insights (errores, latencia)
- [ ] Limpiar `MensajesProcessados` > 7 días
- [ ] Verificar consumo de tokens de IA
- [ ] Revisar fragmentación de índices SQL

## Checklist Mensual

- [ ] Limpiar `HistorialSesiones` > 3 meses
- [ ] Revisar costos de Azure (IA, SQL, Redis)
- [ ] Rebuild de índices con fragmentación > 30%
- [ ] Verificar que `DeadLetterMessages` procesadas > 30 días se eliminen
- [ ] Exportar métricas de encuestas para reporting
