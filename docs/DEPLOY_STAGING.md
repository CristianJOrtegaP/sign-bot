# AC FixBot - Deploy a Staging

**Fecha**: 2026-02-03
**Estado**: Lista para deploy

---

## Pre-requisitos

### 1. Herramientas Necesarias

```bash
# Azure CLI
az --version  # Verificar instalación

# Si no está instalado:
# Mac: brew install azure-cli
# Windows: https://aka.ms/installazurecliwindows

# Node.js (>= 20.x)
node --version

# Azure Functions Core Tools (opcional, recomendado)
npm install -g azure-functions-core-tools@4
```

### 2. Credenciales Azure

```bash
# Login a Azure
az login

# Verificar suscripción activa
az account show

# Si tienes múltiples suscripciones, seleccionar la correcta
az account set --subscription "NOMBRE_O_ID_SUSCRIPCION"
```

---

## Opción 1: Deploy Automático (Recomendado)

### Usar Script de Deploy

```bash
# 1. Configurar ambiente staging
cd scripts/azure
cp config.env.example config.env

# 2. Editar config.env con valores de staging
# IMPORTANTE: Cambiar ENVIRONMENT="staging"
nano config.env

# 3. Ejecutar deploy
./deploy-function.sh
```

**El script hará automáticamente**:

- ✅ Verificar pre-requisitos
- ✅ Instalar dependencias de producción
- ✅ Crear package de deployment
- ✅ Subir a Azure
- ✅ Verificar que el deploy funcionó

---

## Opción 2: Deploy Manual (Paso a Paso)

### Paso 1: Preparar Configuración

```bash
cd /Users/cristianjortegap/Developer/acfixbot-poc
```

Crear archivo `scripts/azure/config.env` con esta configuración:

```bash
# Configuración de Staging
RESOURCE_GROUP="rg-acfixbot-staging"
LOCATION="westus2"
ENVIRONMENT="staging"

# SQL Server
SQL_SERVER_NAME="sql-acfixbot-staging"
SQL_ADMIN_USER="acfixbotadmin"
SQL_ADMIN_PASSWORD="TU_PASSWORD_SEGURO"  # CAMBIAR
SQL_DATABASE_NAME="db-acfixbot-staging"
SQL_SKU="S0"  # Standard para staging

# Storage Account
STORAGE_ACCOUNT_NAME="stacfixbotstaging"
STORAGE_SKU="Standard_LRS"

# Function App
FUNCTION_APP_NAME="func-acfixbot-staging"
FUNCTION_RUNTIME="node"
FUNCTION_RUNTIME_VERSION="22"
FUNCTION_PLAN_SKU="Y1"  # Consumption plan

# Computer Vision
COMPUTER_VISION_NAME="cv-acfixbot-staging"
COMPUTER_VISION_SKU="S1"

# WhatsApp Business API
WHATSAPP_TOKEN="TU_TOKEN"  # Obtener de Meta Business
WHATSAPP_PHONE_ID="TU_PHONE_ID"
WHATSAPP_VERIFY_TOKEN="staging_verify_token_2026"
WHATSAPP_APP_SECRET="TU_APP_SECRET"

# AI Provider
AI_PROVIDER="gemini"  # O "azure-openai" si ya tienes
USE_AI="true"
GEMINI_API_KEY="TU_GEMINI_KEY"  # Si usas Gemini

# Configuración de Sesiones
SESSION_TIMEOUT_MINUTES="30"
SESSION_WARNING_MINUTES="25"

# FASE 2: Alerting
ALERT_WEBHOOK_URL="https://hooks.slack.com/services/TU_WEBHOOK"  # Opcional

# FASE 2: Admin API Key
ADMIN_API_KEY="staging_api_key_secure_2026"  # CAMBIAR por algo seguro
```

---

### Paso 2: Crear Infraestructura (Si no existe)

```bash
# Solo si es la primera vez o no tienes infraestructura de staging
cd scripts/azure
./deploy-infrastructure.sh
```

**Esto creará**:

- Resource Group
- SQL Server + Database
- Storage Account
- Function App
- Computer Vision (opcional)

**Tiempo estimado**: 5-10 minutos

---

### Paso 3: Inicializar Base de Datos

```bash
# Ejecutar SQL scripts en staging
cd /Users/cristianjortegap/Developer/acfixbot-poc/sql-scripts

# Opción A: Script automatizado
./install.sh

# Seleccionar:
# - Server: sql-acfixbot-staging.database.windows.net
# - Database: db-acfixbot-staging
# - User: acfixbotadmin
# - Password: (tu password)
# - Opción: 1 (Instalación completa)

# Opción B: Manual con sqlcmd
sqlcmd -S sql-acfixbot-staging.database.windows.net \
  -d db-acfixbot-staging \
  -U acfixbotadmin \
  -P "TU_PASSWORD" \
  -i install-full-database.sql

sqlcmd -S sql-acfixbot-staging.database.windows.net \
  -d db-acfixbot-staging \
  -U acfixbotadmin \
  -P "TU_PASSWORD" \
  -i install_complete.sql
```

---

### Paso 4: Deploy del Código

#### Opción A: Con Azure Functions Core Tools (Recomendado)

```bash
cd /Users/cristianjortegap/Developer/acfixbot-poc

# Instalar dependencias de producción
npm ci --omit=dev

# Deploy
func azure functionapp publish func-acfixbot-staging --javascript
```

#### Opción B: Con Azure CLI

```bash
cd /Users/cristianjortegap/Developer/acfixbot-poc

# Instalar dependencias
npm ci --omit=dev

# Crear ZIP
zip -r function-app.zip . \
  -x "*.git*" -x "node_modules/@types/*" -x "tests/*" \
  -x ".env*" -x "*.md" -x "docs/*"

# Deploy
az functionapp deployment source config-zip \
  --resource-group rg-acfixbot-staging \
  --name func-acfixbot-staging \
  --src function-app.zip \
  --build-remote true
```

---

### Paso 5: Configurar Variables de Entorno

```bash
# Opción A: Usar script automatizado
cd scripts/azure
./update-app-settings.sh

# Opción B: Manual con Azure CLI
az functionapp config appsettings set \
  --resource-group rg-acfixbot-staging \
  --name func-acfixbot-staging \
  --settings \
    WHATSAPP_TOKEN="$WHATSAPP_TOKEN" \
    WHATSAPP_PHONE_ID="$WHATSAPP_PHONE_ID" \
    WHATSAPP_VERIFY_TOKEN="$WHATSAPP_VERIFY_TOKEN" \
    WHATSAPP_APP_SECRET="$WHATSAPP_APP_SECRET" \
    USE_AI="true" \
    AI_PROVIDER="gemini" \
    GEMINI_API_KEY="$GEMINI_API_KEY" \
    SESSION_TIMEOUT_MINUTES="30" \
    ADMIN_API_KEY="$ADMIN_API_KEY" \
    NODE_ENV="staging"

# Obtener connection strings automáticamente
SQL_CONN=$(az sql db show-connection-string \
  --server sql-acfixbot-staging \
  --name db-acfixbot-staging \
  --client ado.net \
  --output tsv)

STORAGE_CONN=$(az storage account show-connection-string \
  --name stacfixbotstaging \
  --resource-group rg-acfixbot-staging \
  --output tsv)

az functionapp config appsettings set \
  --resource-group rg-acfixbot-staging \
  --name func-acfixbot-staging \
  --settings \
    SQL_CONNECTION_STRING="$SQL_CONN" \
    BLOB_CONNECTION_STRING="$STORAGE_CONN" \
    AzureWebJobsStorage="$STORAGE_CONN"
```

---

## Verificación Post-Deploy

### 1. Health Checks

```bash
# Esperar 30 segundos para que la app inicie
sleep 30

# Verificar health endpoint
curl https://func-acfixbot-staging.azurewebsites.net/api/health

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

### 2. Verificar Funciones Desplegadas

```bash
az functionapp function list \
  --resource-group rg-acfixbot-staging \
  --name func-acfixbot-staging \
  --output table

# Deberías ver:
# - api-whatsapp-webhook
# - api-health
# - api-admin-cache
# - api-ticket-resolve
# - timer-session-cleanup
# - timer-survey-sender
```

### 3. Probar Webhook de WhatsApp

```bash
# Endpoint de verificación (GET)
VERIFY_TOKEN="staging_verify_token_2026"
curl "https://func-acfixbot-staging.azurewebsites.net/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=$VERIFY_TOKEN&hub.challenge=test123"

# Debería retornar: test123
```

### 4. Probar API de Métricas

```bash
# Obtener métricas (requiere API key)
curl https://func-acfixbot-staging.azurewebsites.net/api/metrics \
  -H "x-api-key: staging_api_key_secure_2026"

# Respuesta esperada:
# {
#   "timestamp": "...",
#   "operations": {...},
#   "percentiles": {...},
#   "slaCompliance": {...}
# }
```

---

## Ejecutar Tests contra Staging

### 1. Tests de Health

```bash
cd /Users/cristianjortegap/Developer/acfixbot-poc

# Crear archivo de configuración para tests
cat > tests/staging.env <<EOF
STAGING_URL=https://func-acfixbot-staging.azurewebsites.net
STAGING_API_KEY=staging_api_key_secure_2026
EOF

# Ejecutar tests de health
curl https://func-acfixbot-staging.azurewebsites.net/api/health | jq
```

### 2. Tests de Integración

```bash
# Test de mensaje simple (requiere configurar webhook en Meta)
curl -X POST https://func-acfixbot-staging.azurewebsites.net/api/whatsapp-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "from": "+5215512345678",
            "id": "wamid.test_staging_001",
            "timestamp": "1234567890",
            "type": "text",
            "text": { "body": "test staging" }
          }]
        }
      }]
    }]
  }'
```

---

## Monitoreo en Application Insights

### Ver Logs en Tiempo Real

```bash
# Opción A: Azure CLI
az functionapp log tail \
  --resource-group rg-acfixbot-staging \
  --name func-acfixbot-staging

# Opción B: Azure Portal
# 1. Ir a Azure Portal
# 2. Buscar "func-acfixbot-staging"
# 3. Monitoring > Log stream
```

### Queries útiles en Application Insights

```kusto
// Ver todos los requests de las últimas 24h
requests
| where timestamp > ago(24h)
| project timestamp, name, success, duration, resultCode
| order by timestamp desc

// Ver errores FASE 1: ConcurrencyError
traces
| where message contains "ConcurrencyError"
| order by timestamp desc

// Ver métricas FASE 2
customMetrics
| where name startswith "acfixbot"
| summarize avg(value) by name, bin(timestamp, 5m)
| render timechart

// Ver alertas enviadas (FASE 2)
traces
| where message contains "[ALERT]"
| order by timestamp desc

// SLA Compliance
traces
| where message contains "[METRICS]"
| extend duration = todouble(customDimensions.duration_ms)
| summarize
    within=countif(duration <= 1000),
    total=count()
| extend compliance=(within * 100.0) / total
```

---

## Configurar WhatsApp Business API

### En Meta Business Manager

1. Ir a https://developers.facebook.com
2. Tu App > WhatsApp > Configuration
3. **Webhook URL**:
   ```
   https://func-acfixbot-staging.azurewebsites.net/api/whatsapp-webhook
   ```
4. **Verify Token**:
   ```
   staging_verify_token_2026
   ```
5. **Subscribe to**: `messages`
6. Guardar y verificar

---

## Troubleshooting

### Error: "Connection timeout" en DB

**Solución**: Agregar tu IP al firewall de SQL Server

```bash
# Obtener tu IP
MY_IP=$(curl -s ifconfig.me)

# Agregar regla de firewall
az sql server firewall-rule create \
  --resource-group rg-acfixbot-staging \
  --server sql-acfixbot-staging \
  --name AllowMyIP \
  --start-ip-address $MY_IP \
  --end-ip-address $MY_IP
```

### Error: "Function app not found"

**Solución**: Verificar que el nombre es correcto

```bash
# Listar todas las function apps
az functionapp list --output table

# Si no existe, crearla con deploy-infrastructure.sh
```

### Error: "Package too large"

**Solución**: Usar build remoto

```bash
az functionapp deployment source config-zip \
  --resource-group rg-acfixbot-staging \
  --name func-acfixbot-staging \
  --src function-app.zip \
  --build-remote true  # ← Importante
```

### Health check retorna "degraded"

**Causas comunes**:

- BD no inicializada (ejecutar install-full-database.sql)
- Connection strings incorrectos
- Firewall bloqueando conexión

---

## Checklist de Validación

Antes de considerar el deploy exitoso, verificar:

### Funcionalidad Básica

- [ ] Health endpoint retorna "healthy"
- [ ] Todas las funciones están desplegadas (6 funciones)
- [ ] Webhook de WhatsApp verifica correctamente
- [ ] Base de datos tiene todas las tablas (5 principales)

### FASE 1: Fixes Críticos

- [ ] Columna `Version` existe en `SesionesChat`
- [ ] Columnas `Reintentos`, `UltimoReintento`, `Telefono` existen en `MensajesProcessados`
- [ ] Índices de FASE 1 creados correctamente

### FASE 2: Monitoring & Alerting

- [ ] API de métricas responde (`/api/metrics`)
- [ ] Application Insights recibiendo telemetría
- [ ] Alert webhook configurado (opcional pero recomendado)

### Tests

- [ ] Tests básicos de FASE 1 pasan contra staging
- [ ] Mensaje de prueba se procesa correctamente
- [ ] No hay errores críticos en logs

---

## Próximos Pasos Post-Deploy

### 1. Monitoreo Continuo (24-48h)

```bash
# Ver métricas críticas cada hora
watch -n 3600 'curl -s https://func-acfixbot-staging.azurewebsites.net/api/metrics \
  -H "x-api-key: staging_api_key_secure_2026" | jq ".errorRates, .slaCompliance"'
```

### 2. Testing Exhaustivo (Opcional - 2 días)

Si decides hacer testing exhaustivo antes de producción:

- Arreglar mocks de FASE 2
- Tests de performance con Artillery
- Tests de seguridad

### 3. Rollout a Producción (3-5 días)

Una vez validado staging:

- Canary deployment (10%)
- Gradual increase (25% → 50% → 100%)
- Monitor continuo de métricas

---

## Rollback Plan

Si algo sale mal en staging:

```bash
# Opción 1: Rollback desde Azure Portal
# 1. Ir a Function App > Deployment Center
# 2. Deployment History
# 3. Seleccionar deployment anterior > Redeploy

# Opción 2: Rollback con Azure CLI
az functionapp deployment list \
  --name func-acfixbot-staging \
  --resource-group rg-acfixbot-staging

# Obtener ID del deployment anterior y redeployar
az functionapp deployment source sync \
  --name func-acfixbot-staging \
  --resource-group rg-acfixbot-staging
```

---

## Referencias

- [Script de Deploy](../scripts/azure/deploy-function.sh)
- [Testing Básico](./TESTING_BASICO.md)
- [FASE 1 Implementación](./FASE_1_IMPLEMENTACION_RESUMEN.md)
- [FASE 2 Monitoring](./FASE2-MONITORING-ALERTING.md)
- [Observability Guide](./observability-guide.md)

---

**¿Listo para deploy?** Ejecuta:

```bash
cd /Users/cristianjortegap/Developer/acfixbot-poc/scripts/azure
./deploy-function.sh
```
