# Deploy a Staging - Quick Start

**Tiempo estimado**: 15-30 minutos (dependiendo si la infraestructura ya existe)

---

## Antes de Empezar

**¿Ya tienes infraestructura de staging en Azure?**

- **SÍ** → Ir directo a [Opción 1: Deploy Rápido](#opción-1-deploy-rápido-5-10-min)
- **NO** → Seguir [Opción 2: Deploy Completo](#opción-2-deploy-completo-primera-vez-20-30-min)

---

## Opción 1: Deploy Rápido (5-10 min)

**Prerequisito**: Ya tienes Function App, SQL Database, Storage Account en Azure

### Paso 1: Configurar Credenciales

```bash
# Login a Azure
az login

# Verificar que estás en la suscripción correcta
az account show
```

### Paso 2: Ejecutar Script de Deploy

```bash
cd /Users/cristianjortegap/Developer/acfixbot-poc

# Ejecutar deploy automatizado
./scripts/deploy-to-staging.sh
```

**El script hará automáticamente**:

1. ✅ Verificar Azure CLI y Node.js
2. ✅ Ejecutar tests de FASE 1 (24 tests)
3. ✅ Crear package de deployment
4. ✅ Subir a Azure Function App
5. ✅ Verificar health checks
6. ✅ Listar funciones desplegadas

**Tiempo**: 5-10 minutos

---

## Opción 2: Deploy Completo (Primera Vez) (20-30 min)

**Prerequisito**: No tienes infraestructura de staging en Azure

### Paso 1: Configurar Variables de Entorno

```bash
cd /Users/cristianjortegap/Developer/acfixbot-poc/scripts/azure

# Copiar ejemplo
cp config.env.example config.env

# Editar con tus valores
nano config.env
```

**Valores críticos a cambiar**:

```bash
# En config.env
ENVIRONMENT="staging"
RESOURCE_GROUP="rg-acfixbot-staging"

# SQL Server (CAMBIAR PASSWORD)
SQL_ADMIN_PASSWORD="TuPasswordSeguro123!"

# WhatsApp (obtener de Meta Business)
WHATSAPP_TOKEN="tu_token_de_meta"
WHATSAPP_PHONE_ID="123456789012345"
WHATSAPP_VERIFY_TOKEN="staging_verify_2026"
WHATSAPP_APP_SECRET="tu_app_secret"

# AI Provider
AI_PROVIDER="gemini"  # O "azure-openai"
GEMINI_API_KEY="tu_gemini_key"  # Si usas Gemini

# FASE 2: Admin API Key (para /api/metrics)
ADMIN_API_KEY="staging_admin_key_2026"

# FASE 2: Alert Webhook (opcional)
ALERT_WEBHOOK_URL="https://hooks.slack.com/services/tu-webhook"
```

### Paso 2: Crear Infraestructura en Azure

```bash
cd /Users/cristianjortegap/Developer/acfixbot-poc/scripts/azure

# Login a Azure
az login

# Desplegar infraestructura
./deploy-infrastructure.sh
```

**Esto creará**:

- Resource Group
- SQL Server + Database
- Storage Account
- Function App
- Application Insights

**Tiempo**: 5-10 minutos

### Paso 3: Inicializar Base de Datos

```bash
cd /Users/cristianjortegap/Developer/acfixbot-poc/sql-scripts

# Ejecutar script de instalación
./install.sh

# Cuando te pida:
# - SQL Server: sql-acfixbot-staging.database.windows.net
# - Database: db-acfixbot-staging
# - Usuario: acfixbotadmin
# - Password: (el que pusiste en config.env)
# - Opción: 1 (Instalación completa: schema base + FASE 1)
```

**Esto instalará**:

- Schema base (tablas, stored procedures, triggers)
- FASE 1: Optimistic Locking (columna Version)
- FASE 1: Deduplicación (columnas Reintentos, UltimoReintento, Telefono)
- Estados adicionales

**Tiempo**: 2-3 minutos

### Paso 4: Deploy del Código

```bash
cd /Users/cristianjortegap/Developer/acfixbot-poc

# Deploy automatizado
./scripts/deploy-to-staging.sh
```

**Tiempo**: 5-10 minutos

---

## Verificación Post-Deploy

### 1. Health Check

```bash
# Obtener el nombre de tu Function App
FUNCTION_APP="func-acfixbot-staging"  # O el que configuraste

# Verificar health
curl https://${FUNCTION_APP}.azurewebsites.net/api/health | jq

# Respuesta esperada:
# {
#   "status": "healthy",
#   "checks": {
#     "database": { "status": "healthy" },
#     "whatsappApi": { "status": "healthy" },
#     "aiProvider": { "status": "healthy" }
#   }
# }
```

### 2. Ver Funciones Desplegadas

```bash
az functionapp function list \
  --resource-group rg-acfixbot-staging \
  --name func-acfixbot-staging \
  --output table

# Deberías ver 6+ funciones:
# - api-whatsapp-webhook
# - api-health
# - api-admin-cache
# - api-ticket-resolve
# - timer-session-cleanup
# - timer-survey-sender
```

### 3. Probar API de Métricas (FASE 2)

```bash
# Reemplazar con tu API key
API_KEY="staging_admin_key_2026"

curl https://func-acfixbot-staging.azurewebsites.net/api/metrics \
  -H "x-api-key: $API_KEY" | jq

# Respuesta esperada:
# {
#   "timestamp": "2026-02-03T...",
#   "operations": {...},
#   "percentiles": {...},
#   "latencyHistograms": {...},
#   "slaCompliance": {...}
# }
```

---

## Configurar WhatsApp Business

### En Meta Business Manager

1. Ir a https://developers.facebook.com
2. Tu App > WhatsApp > Configuration
3. **Webhook URL**:
   ```
   https://func-acfixbot-staging.azurewebsites.net/api/whatsapp-webhook
   ```
4. **Verify Token**: (el que pusiste en `config.env`)
   ```
   staging_verify_2026
   ```
5. **Subscribe to**: `messages`
6. Click "Verify and Save"

### Enviar Mensaje de Prueba

```bash
# Desde WhatsApp, enviar mensaje al número configurado
# Texto: "test staging"

# Ver logs en tiempo real
az functionapp log tail \
  --name func-acfixbot-staging \
  --resource-group rg-acfixbot-staging
```

---

## Troubleshooting Rápido

### Error: "Connection timeout" en DB

```bash
# Obtener tu IP
MY_IP=$(curl -s ifconfig.me)

# Agregar al firewall de SQL Server
az sql server firewall-rule create \
  --resource-group rg-acfixbot-staging \
  --server sql-acfixbot-staging \
  --name AllowMyIP \
  --start-ip-address $MY_IP \
  --end-ip-address $MY_IP
```

### Error: "Function app not found"

```bash
# Listar Function Apps
az functionapp list --output table

# Si no existe, ejecutar deploy-infrastructure.sh primero
```

### Health check retorna "degraded"

**Causas comunes**:

1. BD no inicializada → Ejecutar `sql-scripts/install.sh`
2. Connection strings incorrectos → Verificar en Azure Portal
3. Firewall bloqueando → Agregar tu IP (ver arriba)

---

## Ver Logs en Tiempo Real

### Opción 1: Azure CLI (Recomendado)

```bash
az functionapp log tail \
  --name func-acfixbot-staging \
  --resource-group rg-acfixbot-staging \
  --filter Error=all
```

### Opción 2: Azure Portal

1. Ir a https://portal.azure.com
2. Buscar "func-acfixbot-staging"
3. Monitoring > Log stream

### Opción 3: Application Insights

```kusto
// Ver requests recientes
requests
| where timestamp > ago(1h)
| order by timestamp desc

// Ver errores de FASE 1 (ConcurrencyError)
traces
| where message contains "ConcurrencyError"
| order by timestamp desc

// Ver métricas de FASE 2
customMetrics
| where name startswith "acfixbot"
| summarize avg(value) by name
```

---

## Métricas Clave a Monitorear

Después del deploy, monitorear estas métricas en Application Insights:

| Métrica                   | Target  | Warning | Critical |
| ------------------------- | ------- | ------- | -------- |
| **Error Rate**            | <5%     | >5%     | >10%     |
| **SLA Compliance**        | >95%    | <95%    | <90%     |
| **P95 Latency**           | <1000ms | >1500ms | >2000ms  |
| **Memory Usage**          | <80%    | >80%    | >90%     |
| **ConcurrencyError Rate** | <5%     | >5%     | >10%     |
| **Duplicate Messages**    | <10%    | >10%    | >20%     |

---

## Próximos Pasos

### ✅ Deploy Exitoso

Si todo funcionó:

1. **Monitorear 24-48h** en staging
2. **Enviar mensajes de prueba** de diferentes tipos
3. **Verificar métricas** en Application Insights
4. **Validar alertas** (si configuraste webhook)

### 🚀 Siguiente: Producción

Una vez validado staging (24-48h):

- [Rollout Gradual a Producción](./ROLLOUT_PRODUCTION.md)
- Canary deployment (10%)
- Gradual increase (25% → 50% → 100%)

---

## Checklist de Validación

Antes de considerar staging como exitoso:

### Funcionalidad Básica

- [ ] Health endpoint retorna "healthy"
- [ ] 6+ funciones desplegadas
- [ ] Webhook de WhatsApp verifica correctamente
- [ ] Mensaje de prueba se procesa

### FASE 1: Fixes Críticos

- [ ] Columna `Version` existe en DB
- [ ] Columnas de deduplicación existen
- [ ] Índices creados correctamente
- [ ] Tests básicos pasan (24/24)

### FASE 2: Monitoring

- [ ] API `/api/metrics` responde
- [ ] Application Insights recibiendo telemetría
- [ ] Métricas enhanced visibles
- [ ] Alertas funcionando (si configurado)

### Tests

- [ ] Mensaje de texto se procesa
- [ ] No hay errores críticos en logs
- [ ] SLA compliance >95%
- [ ] Error rate <5%

---

## Recursos

- [Deploy Staging (Guía Completa)](./DEPLOY_STAGING.md)
- [Testing Básico](./TESTING_BASICO.md)
- [FASE 1 Implementación](./FASE_1_IMPLEMENTACION_RESUMEN.md)
- [FASE 2 Monitoring](./FASE2-MONITORING-ALERTING.md)
- [Observability Guide](./observability-guide.md)

---

## ¿Necesitas Ayuda?

**Errores comunes**:

1. Firewall de SQL → Agregar tu IP
2. Function App no existe → Ejecutar deploy-infrastructure.sh
3. Health check degraded → Verificar connection strings

**Logs y Debugging**:

```bash
# Ver logs
az functionapp log tail --name func-acfixbot-staging --resource-group rg-acfixbot-staging

# Ver configuración
az functionapp config appsettings list --name func-acfixbot-staging --resource-group rg-acfixbot-staging

# Reiniciar app
az functionapp restart --name func-acfixbot-staging --resource-group rg-acfixbot-staging
```

---

**¿Listo?** Ejecuta:

```bash
./scripts/deploy-to-staging.sh
```
