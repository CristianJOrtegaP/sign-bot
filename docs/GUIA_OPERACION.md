# Guia de Operacion - AC FixBot

Esta guia cubre el monitoreo, mantenimiento y troubleshooting del sistema en produccion.

---

## Indice

1. [Monitoreo del Sistema](#1-monitoreo-del-sistema)
2. [Health Check y Alertas](#2-health-check-y-alertas)
3. [Administracion de Cache](#3-administracion-de-cache)
4. [Gestion de Dead Letter Queue](#4-gestion-de-dead-letter-queue)
5. [Resolucion de Tickets](#5-resolucion-de-tickets)
6. [Troubleshooting Comun](#6-troubleshooting-comun)
7. [Mantenimiento Programado](#7-mantenimiento-programado)
8. [Escalado y Performance](#8-escalado-y-performance)
9. [Logs y Trazabilidad](#9-logs-y-trazabilidad)
10. [Procedimientos de Emergencia](#10-procedimientos-de-emergencia)

---

## 1. Monitoreo del Sistema

### Dashboard Rapido

El endpoint `/api/health` proporciona un resumen completo:

```bash
curl https://func-acfixbot-prod.azurewebsites.net/api/health | jq
```

### Metricas Clave

| Metrica | Valor Normal | Alerta |
|---------|--------------|--------|
| `status` | `healthy` | `unhealthy` |
| `database.status` | `healthy` | Cualquier otro |
| `memory.heapPercentage` | `<80%` | `>90%` |
| `circuitBreakers.ai` | `closed` | `open` |
| `circuitBreakers.whatsapp` | `closed` | `open` |
| `deadLetter.failed` | `<10` | `>10` |

### Ejemplo de Respuesta Saludable

```json
{
    "status": "healthy",
    "timestamp": "2026-01-27T10:30:00.000Z",
    "version": "2.0.0",
    "environment": "production",
    "responseTimeMs": 45,
    "checks": {
        "database": {
            "status": "healthy",
            "responseTimeMs": 23
        },
        "configuration": {
            "status": "healthy",
            "servicesConfigured": true
        },
        "memory": {
            "status": "healthy",
            "heapUsedMB": 45,
            "heapTotalMB": 128,
            "heapPercentage": 35
        },
        "uptime": {
            "status": "healthy",
            "uptimeSeconds": 3600
        },
        "circuitBreakers": {
            "status": "healthy",
            "services": {
                "ai": { "status": "closed", "provider": "gemini", "enabled": true },
                "whatsapp": { "status": "closed" }
            }
        },
        "deadLetter": {
            "status": "healthy",
            "total": 5,
            "pending": 3,
            "failed": 2,
            "message": "OK"
        },
        "externalServices": {
            "status": "healthy",
            "services": {
                "ai": { "configured": true, "provider": "gemini" },
                "vision": { "configured": true },
                "whatsapp": { "configured": true }
            }
        }
    }
}
```

---

## 2. Health Check y Alertas

### Configurar Alerta en Azure

```bash
# Crear Action Group para notificaciones
az monitor action-group create \
    --name "ag-acfixbot-alerts" \
    --resource-group rg-acfixbot-prod \
    --short-name "acfixbot" \
    --email-receiver name="admin" email="admin@tuempresa.com"

# Crear alerta de disponibilidad
az monitor metrics alert create \
    --name "alerta-health-check" \
    --resource-group rg-acfixbot-prod \
    --scopes "/subscriptions/.../func-acfixbot-prod" \
    --condition "avg Http5xx > 5" \
    --action "/subscriptions/.../ag-acfixbot-alerts" \
    --description "Alertar si hay mas de 5 errores 500 por minuto"
```

### Monitoreo Externo (Recomendado)

Configurar un servicio externo (UptimeRobot, Pingdom, etc.) para:

- **URL:** `https://func-acfixbot-prod.azurewebsites.net/api/health`
- **Intervalo:** Cada 5 minutos
- **Alerta:** Si status != 200 por 3 checks consecutivos

---

## 3. Administracion de Cache

### Endpoint de Administracion

```
GET/POST /api/admin-cache?type=<operacion>
Header: X-API-Key: <tu-api-key>
```

### Operaciones Disponibles

| Operacion | Descripcion | Ejemplo |
|-----------|-------------|---------|
| `stats` | Ver estadisticas del cache | `?type=stats` |
| `equipos` | Limpiar cache de equipos | `?type=equipos` |
| `equipos` + codigo | Limpiar equipo especifico | `?type=equipos&codigo=4045101` |
| `sesiones` | Limpiar todas las sesiones | `?type=sesiones` |
| `sesiones` + telefono | Limpiar sesion especifica | `?type=sesiones&telefono=5218112345678` |
| `all` | Limpiar todo el cache | `?type=all` |
| `trigger_timeout` | Ejecutar limpieza de sesiones expiradas | `?type=trigger_timeout` |

### Ejemplos de Uso

```bash
# Ver estadisticas
curl -H "X-API-Key: tu-key" \
    "https://func-acfixbot-prod.azurewebsites.net/api/admin-cache?type=stats"

# Limpiar sesion de usuario especifico
curl -H "X-API-Key: tu-key" \
    "https://func-acfixbot-prod.azurewebsites.net/api/admin-cache?type=sesiones&telefono=5218112345678"

# Limpiar todo el cache (usar con precaucion)
curl -H "X-API-Key: tu-key" \
    "https://func-acfixbot-prod.azurewebsites.net/api/admin-cache?type=all"
```

### Cuando Limpiar Cache

| Situacion | Accion |
|-----------|--------|
| Usuario reporta datos incorrectos | Limpiar sesion del usuario |
| Se actualizo catalogo de equipos | Limpiar cache de equipos |
| Muchos errores de "equipo no encontrado" | Verificar y limpiar cache de equipos |
| Despues de actualizacion de BD | Limpiar todo el cache |

---

## 4. Gestion de Dead Letter Queue

### Que es la Dead Letter Queue

Almacena mensajes que fallaron durante el procesamiento para reintento posterior.

### Ver Estadisticas

```bash
curl https://func-acfixbot-prod.azurewebsites.net/api/health | jq '.checks.deadLetter'
```

### Estados de Mensajes

| Estado | Descripcion |
|--------|-------------|
| `PENDING` | Pendiente de reintento |
| `RETRYING` | En proceso de reintento |
| `PROCESSED` | Procesado exitosamente |
| `FAILED` | Fallado definitivamente (max reintentos) |

### Consultar Dead Letter (SQL)

```sql
-- Ver mensajes pendientes
SELECT TOP 10 *
FROM DeadLetterMessages
WHERE Estado = 'PENDING'
ORDER BY CreatedAt DESC;

-- Ver mensajes fallados
SELECT *
FROM DeadLetterMessages
WHERE Estado = 'FAILED'
ORDER BY CreatedAt DESC;

-- Estadisticas por estado
SELECT Estado, COUNT(*) as Total
FROM DeadLetterMessages
GROUP BY Estado;
```

### Reprocesar Mensajes Fallados

```sql
-- Resetear para reintentar
UPDATE DeadLetterMessages
SET Estado = 'PENDING',
    RetryCount = 0,
    NextRetryAt = GETDATE()
WHERE Estado = 'FAILED'
AND DeadLetterId = @id;
```

---

## 5. Resolucion de Tickets

### API de Resolucion

```bash
POST /api/ticket-resolve
Header: x-functions-key: <azure-function-key>
Content-Type: application/json

{
    "ticketId": "TKT1706300000000"
}
```

### Ejemplo

```bash
curl -X POST \
    -H "x-functions-key: tu-function-key" \
    -H "Content-Type: application/json" \
    -d '{"ticketId": "TKT1706300000000"}' \
    https://func-acfixbot-prod.azurewebsites.net/api/ticket-resolve
```

### Respuestas

| Status | Descripcion |
|--------|-------------|
| 200 | Ticket resuelto exitosamente |
| 400 | ticketId invalido o ticket ya resuelto/cancelado |
| 404 | Ticket no encontrado |
| 500 | Error interno |

### Flujo Post-Resolucion

1. Ticket marcado como RESUELTO en BD
2. A las 24 horas, el timer de encuestas enviara invitacion al usuario
3. Usuario puede responder encuesta de satisfaccion

---

## 6. Troubleshooting Comun

### Problema: Usuario no recibe respuesta

**Pasos de diagnostico:**

1. Verificar health check:
```bash
curl https://func-acfixbot-prod.azurewebsites.net/api/health
```

2. Verificar logs:
```bash
az webapp log tail --name func-acfixbot-prod --resource-group rg-acfixbot-prod
```

3. Buscar mensaje en Dead Letter:
```sql
SELECT * FROM DeadLetterMessages
WHERE Telefono = '5218112345678'
ORDER BY CreatedAt DESC;
```

4. Verificar estado de sesion:
```sql
SELECT * FROM SesionesChat
WHERE Telefono = '5218112345678';
```

**Soluciones comunes:**
- Limpiar sesion del usuario
- Verificar que el webhook esta activo en Meta
- Verificar Circuit Breaker de WhatsApp

### Problema: Equipo no encontrado

1. Verificar que el equipo existe en BD:
```sql
SELECT * FROM Equipos
WHERE CodigoSAP = '4045101';
```

2. Si existe, limpiar cache:
```bash
curl -H "X-API-Key: key" \
    "https://func-acfixbot-prod.azurewebsites.net/api/admin-cache?type=equipos&codigo=4045101"
```

3. Si no existe, agregar al catalogo:
```sql
INSERT INTO Equipos (CodigoSAP, Modelo, ClienteId, Activo)
VALUES ('4045101', 'Refrigerador XYZ', 1, 1);
```

### Problema: IA no responde (Circuit Breaker abierto)

1. Verificar estado del circuit breaker:
```bash
curl https://func-acfixbot-prod.azurewebsites.net/api/health | jq '.checks.circuitBreakers'
```

2. Si esta abierto, esperar 1 minuto para que se resetee automaticamente

3. Verificar credenciales de IA:
   - Gemini: Verificar `GEMINI_API_KEY`
   - Azure OpenAI: Verificar `AZURE_OPENAI_ENDPOINT` y `AZURE_OPENAI_KEY`

4. Mientras la IA no funciona, el sistema usa fallback por regex

### Problema: Encuestas no se envian

1. Verificar timer:
```bash
az functionapp function show \
    --name func-acfixbot-prod \
    --resource-group rg-acfixbot-prod \
    --function-name timer-survey-sender
```

2. Verificar tickets elegibles:
```sql
SELECT r.NumeroTicket, r.FechaResolucion, r.Estado
FROM Reportes r
WHERE r.Estado = 'RESUELTO'
AND r.FechaResolucion < DATEADD(HOUR, -24, GETDATE())
AND NOT EXISTS (
    SELECT 1 FROM Encuestas e
    WHERE e.ReporteId = r.ReporteId
);
```

3. Ejecutar timer manualmente via admin cache:
```bash
curl -H "X-API-Key: key" \
    "https://func-acfixbot-prod.azurewebsites.net/api/admin-cache?type=trigger_survey"
```

---

## 7. Mantenimiento Programado

### Diario

- [ ] Verificar health check
- [ ] Revisar Dead Letter Queue (mensajes fallados)
- [ ] Monitorear uso de memoria

### Semanal

- [ ] Revisar logs de errores
- [ ] Verificar estadisticas de encuestas
- [ ] Limpiar cache de equipos si hubo cambios en catalogo

### Mensual

- [ ] Backup de base de datos
- [ ] Revisar costos de Azure
- [ ] Actualizar dependencias de Node.js
- [ ] Revisar metricas de rendimiento

### Script de Backup

```bash
#!/bin/bash
# scripts/backup.sh

DATE=$(date +%Y%m%d)
STORAGE_KEY="tu-storage-key"

az sql db export \
    --resource-group rg-acfixbot-prod \
    --server sql-acfixbot-prod \
    --name db-acfixbot \
    --admin-user sqladmin \
    --admin-password $SQL_PASSWORD \
    --storage-key-type StorageAccessKey \
    --storage-key $STORAGE_KEY \
    --storage-uri "https://stacfixbotprod.blob.core.windows.net/backups/backup-$DATE.bacpac"

echo "Backup completado: backup-$DATE.bacpac"
```

---

## 8. Escalado y Performance

### Metricas de Rendimiento

| Metrica | Valor Esperado | Accion si excede |
|---------|----------------|------------------|
| Tiempo respuesta webhook | <2 segundos | Revisar BD y IA |
| Mensajes/minuto | <100 | Revisar rate limiting |
| Memoria heap | <80% | Reiniciar Function App |
| Errores 5xx/hora | <10 | Revisar logs |

### Cuando Escalar

| Indicador | Umbral | Accion |
|-----------|--------|--------|
| Reportes/dia | >500 | Considerar Redis Cache |
| Latencia BD | >500ms | Subir tier de SQL (S0→S1) |
| Timeout de IA | >5% | Revisar proveedor alternativo |
| Cold starts frecuentes | >20/hora | Considerar Premium Plan |

### Escalar Base de Datos

```bash
# Subir de S0 a S1
az sql db update \
    --resource-group rg-acfixbot-prod \
    --server sql-acfixbot-prod \
    --name db-acfixbot \
    --service-objective S1
```

---

## 9. Logs y Trazabilidad

### Correlation ID

Cada request tiene un ID unico para trazabilidad:

```
[corr-abc123-def456] Mensaje recibido de 5218112345678
[corr-abc123-def456] Intencion detectada: REFRIGERADOR
[corr-abc123-def456] Ticket creado: TKT1706300000000
```

### Buscar por Correlation ID

```bash
# En logs de Azure
az monitor log-analytics query \
    --workspace workspace-id \
    --analytics-query "traces | where message contains 'corr-abc123'"
```

### Buscar por Telefono

```sql
-- En base de datos
SELECT * FROM MensajesChat
WHERE Telefono = '5218112345678'
ORDER BY FechaHora DESC;

-- Incluir reportes
SELECT m.*, r.NumeroTicket, r.Estado
FROM MensajesChat m
LEFT JOIN Reportes r ON m.SesionId = r.SesionId
WHERE m.Telefono = '5218112345678'
ORDER BY m.FechaHora DESC;
```

---

## 10. Procedimientos de Emergencia

### Sistema Completamente Caido

1. **Verificar Azure Status:** https://status.azure.com
2. **Reiniciar Function App:**
```bash
az functionapp restart --name func-acfixbot-prod --resource-group rg-acfixbot-prod
```
3. **Verificar health check**
4. **Revisar logs para identificar causa**

### Base de Datos No Responde

1. Verificar estado del servidor SQL:
```bash
az sql server show --name sql-acfixbot-prod --resource-group rg-acfixbot-prod
```

2. Verificar conexiones activas:
```sql
SELECT COUNT(*) FROM sys.dm_exec_connections;
```

3. Si hay muchas conexiones abiertas, reiniciar Function App

### WhatsApp Webhook Desconectado

1. Ir a Meta for Developers
2. Verificar estado del webhook en WhatsApp > Configuration
3. Re-verificar si es necesario
4. Revisar que `WHATSAPP_VERIFY_TOKEN` no haya cambiado

### Muchos Mensajes en Dead Letter

1. Identificar patron de errores:
```sql
SELECT ErrorMessage, COUNT(*) as Total
FROM DeadLetterMessages
WHERE Estado = 'PENDING'
GROUP BY ErrorMessage;
```

2. Si es error de BD, verificar conexion
3. Si es error de WhatsApp, verificar token
4. Una vez corregido, reprocesar mensajes pendientes

### Contacto de Emergencia

| Situacion | Contacto |
|-----------|----------|
| Problemas Azure | Soporte Azure |
| Problemas WhatsApp API | Meta Developer Support |
| Problemas de codigo | Equipo de desarrollo |

---

**Version:** 2.0.0
**Ultima actualizacion:** Enero 2026
