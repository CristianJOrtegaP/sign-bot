# Guia de Deployment - AC FixBot

Esta guia detalla el proceso de despliegue de AC FixBot en Azure Functions.

---

## Indice

1. [Prerequisitos](#1-prerequisitos)
2. [Crear Recursos en Azure](#2-crear-recursos-en-azure)
3. [Configurar Base de Datos](#3-configurar-base-de-datos)
4. [Deployment con Azure Functions Core Tools](#4-deployment-con-azure-functions-core-tools)
5. [Configurar Variables de Entorno](#5-configurar-variables-de-entorno)
6. [Configurar Webhook de WhatsApp](#6-configurar-webhook-de-whatsapp)
7. [Verificacion Post-Deployment](#7-verificacion-post-deployment)
8. [CI/CD con GitHub Actions](#8-cicd-con-github-actions)
9. [Rollback y Recuperacion](#9-rollback-y-recuperacion)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisitos

### Herramientas Requeridas

```bash
# Node.js 22+
node --version  # v22.x.x

# Azure Functions Core Tools v4
func --version  # 4.x.x

# Azure CLI
az --version  # 2.x.x
```

### Instalacion de Herramientas

```bash
# macOS
brew install node@22
brew install azure-functions-core-tools@4
brew install azure-cli

# Windows (con winget)
winget install OpenJS.NodeJS.LTS
winget install Microsoft.AzureFunctionsCoreTools
winget install Microsoft.AzureCLI

# Linux (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g azure-functions-core-tools@4
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
```

### Cuentas Requeridas

- Cuenta de Azure con suscripcion activa
- Cuenta de Meta for Developers con WhatsApp Business API

---

## 2. Crear Recursos en Azure

### Opcion A: Azure Portal (Manual)

1. **Resource Group**
   - Nombre: `rg-acfixbot-prod`
   - Region: `West US 2` (o la mas cercana)

2. **Azure SQL Server + Database**
   - Server: `sql-acfixbot-prod`
   - Database: `db-acfixbot`
   - SKU: `S0` (10 DTUs)
   - Habilitar: "Allow Azure services"

3. **Storage Account**
   - Nombre: `stacfixbotprod` (sin guiones)
   - SKU: `Standard_LRS`
   - Crear container: `imagenes-tickets`

4. **Function App**
   - Nombre: `func-acfixbot-prod`
   - Runtime: `Node.js 22`
   - Plan: `Consumption (Y1)`
   - Storage: Usar el creado arriba

5. **Computer Vision** (Opcional - OCR)
   - Nombre: `cv-acfixbot-prod`
   - SKU: `S1`

### Opcion B: Azure CLI (Automatizado)

```bash
# Variables
RESOURCE_GROUP="rg-acfixbot-prod"
LOCATION="westus2"
SQL_SERVER="sql-acfixbot-prod"
SQL_DB="db-acfixbot"
SQL_ADMIN="sqladmin"
SQL_PASSWORD="TuPasswordSeguro123!"
STORAGE_ACCOUNT="stacfixbotprod"
FUNCTION_APP="func-acfixbot-prod"

# Login
az login

# Crear Resource Group
az group create --name $RESOURCE_GROUP --location $LOCATION

# Crear SQL Server
az sql server create \
    --name $SQL_SERVER \
    --resource-group $RESOURCE_GROUP \
    --location $LOCATION \
    --admin-user $SQL_ADMIN \
    --admin-password $SQL_PASSWORD

# Crear Database
az sql db create \
    --resource-group $RESOURCE_GROUP \
    --server $SQL_SERVER \
    --name $SQL_DB \
    --service-objective S0

# Permitir Azure Services
az sql server firewall-rule create \
    --resource-group $RESOURCE_GROUP \
    --server $SQL_SERVER \
    --name AllowAzureServices \
    --start-ip-address 0.0.0.0 \
    --end-ip-address 0.0.0.0

# Crear Storage Account
az storage account create \
    --name $STORAGE_ACCOUNT \
    --resource-group $RESOURCE_GROUP \
    --location $LOCATION \
    --sku Standard_LRS

# Crear Function App
az functionapp create \
    --resource-group $RESOURCE_GROUP \
    --consumption-plan-location $LOCATION \
    --runtime node \
    --runtime-version 22 \
    --functions-version 4 \
    --name $FUNCTION_APP \
    --storage-account $STORAGE_ACCOUNT
```

---

## 3. Configurar Base de Datos

### Obtener Connection String

```bash
# Azure CLI
az sql db show-connection-string \
    --server $SQL_SERVER \
    --name $SQL_DB \
    --client ado.net
```

Resultado:

```
Server=tcp:sql-acfixbot-prod.database.windows.net,1433;Database=db-acfixbot;User ID=sqladmin;Password=TuPassword;Encrypt=true;TrustServerCertificate=false;Connection Timeout=30;
```

### Ejecutar Scripts de Inicializacion

```bash
# Conectar con sqlcmd
sqlcmd -S sql-acfixbot-prod.database.windows.net \
    -U sqladmin \
    -P TuPassword \
    -d db-acfixbot \
    -i sql-scripts/install-full-database.sql

# Agregar tabla Dead Letter
sqlcmd -S sql-acfixbot-prod.database.windows.net \
    -U sqladmin \
    -P TuPassword \
    -d db-acfixbot \
    -i sql-scripts/add-dead-letter-table.sql
```

### Alternativa: Azure Data Studio

1. Conectar a `sql-acfixbot-prod.database.windows.net`
2. Abrir `sql-scripts/install-full-database.sql`
3. Ejecutar (F5)
4. Repetir con `add-dead-letter-table.sql`

---

## 4. Deployment con Azure Functions Core Tools

### Primer Deployment

```bash
# 1. Navegar al proyecto
cd acfixbot

# 2. Instalar dependencias
npm ci --production

# 3. Login en Azure
az login

# 4. Deploy
func azure functionapp publish func-acfixbot-prod
```

### Output Esperado

```
Getting site publishing info...
Creating archive for current directory...
Uploading 15.23 MB [####################]  100%
Upload completed successfully.
Deployment completed successfully.
Syncing triggers...
Functions in func-acfixbot-prod:
    api-admin-cache - [httpTrigger]
    api-health - [httpTrigger]
    api-ticket-resolve - [httpTrigger]
    api-whatsapp-webhook - [httpTrigger]
    timer-session-cleanup - [timerTrigger]
    timer-survey-sender - [timerTrigger]
```

---

## 5. Configurar Variables de Entorno

### Via Azure Portal

1. Ir a Function App → Configuration → Application Settings
2. Agregar cada variable

### Via Azure CLI

```bash
# Variables requeridas
az functionapp config appsettings set \
    --name func-acfixbot-prod \
    --resource-group rg-acfixbot-prod \
    --settings \
    SQL_CONNECTION_STRING="Server=tcp:sql-acfixbot-prod.database.windows.net,1433;..." \
    WHATSAPP_TOKEN="EAAGm..." \
    WHATSAPP_PHONE_ID="123456789012345" \
    WHATSAPP_VERIFY_TOKEN="mi_token_secreto" \
    WHATSAPP_APP_SECRET="abc123..."

# Variables de IA
az functionapp config appsettings set \
    --name func-acfixbot-prod \
    --resource-group rg-acfixbot-prod \
    --settings \
    USE_AI="true" \
    AI_PROVIDER="gemini" \
    GEMINI_API_KEY="AIza..."

# Variables de Vision (OCR)
az functionapp config appsettings set \
    --name func-acfixbot-prod \
    --resource-group rg-acfixbot-prod \
    --settings \
    VISION_ENDPOINT="https://cv-acfixbot-prod.cognitiveservices.azure.com/" \
    VISION_KEY="abc123..."

# Variables de sesiones y encuestas
az functionapp config appsettings set \
    --name func-acfixbot-prod \
    --resource-group rg-acfixbot-prod \
    --settings \
    SESSION_TIMEOUT_MINUTES="30" \
    SESSION_WARNING_MINUTES="25" \
    SURVEY_HORAS_ESPERA="24" \
    SURVEY_HORAS_EXPIRACION="72"
```

### Via Key Vault (Recomendado para Produccion)

```bash
# Crear Key Vault
az keyvault create \
    --name kv-acfixbot-prod \
    --resource-group rg-acfixbot-prod \
    --location westus2

# Agregar secretos
az keyvault secret set --vault-name kv-acfixbot-prod --name SQL-CONNECTION-STRING --value "Server=..."
az keyvault secret set --vault-name kv-acfixbot-prod --name WHATSAPP-TOKEN --value "EAAGm..."

# Habilitar Managed Identity en Function App
az functionapp identity assign --name func-acfixbot-prod --resource-group rg-acfixbot-prod

# Dar acceso al Key Vault
PRINCIPAL_ID=$(az functionapp identity show --name func-acfixbot-prod --resource-group rg-acfixbot-prod --query principalId -o tsv)
az keyvault set-policy --name kv-acfixbot-prod --object-id $PRINCIPAL_ID --secret-permissions get list

# Configurar referencias a Key Vault
az functionapp config appsettings set \
    --name func-acfixbot-prod \
    --resource-group rg-acfixbot-prod \
    --settings \
    SQL_CONNECTION_STRING="@Microsoft.KeyVault(VaultName=kv-acfixbot-prod;SecretName=SQL-CONNECTION-STRING)"
```

---

## 6. Configurar Webhook de WhatsApp

### Obtener URL del Webhook

```bash
# La URL sera:
https://func-acfixbot-prod.azurewebsites.net/api/whatsapp-webhook
```

### Configurar en Meta for Developers

1. Ir a [developers.facebook.com](https://developers.facebook.com)
2. Tu App → WhatsApp → Configuration
3. **Callback URL:** `https://func-acfixbot-prod.azurewebsites.net/api/whatsapp-webhook`
4. **Verify Token:** El valor de `WHATSAPP_VERIFY_TOKEN`
5. **Webhook Fields:** Seleccionar `messages`, `message_status_updates`
6. Click "Verify and Save"

### Verificacion

Meta enviara un GET request para verificar:

```
GET /api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=mi_token&hub.challenge=123456
```

El bot respondera con el `challenge` si el token es correcto.

---

## 7. Verificacion Post-Deployment

### Health Check

```bash
curl https://func-acfixbot-prod.azurewebsites.net/api/health | jq
```

Respuesta esperada:

```json
{
  "status": "healthy",
  "checks": {
    "database": { "status": "healthy" },
    "configuration": { "status": "healthy" },
    "circuitBreakers": { "status": "healthy" },
    "externalServices": {
      "ai": { "configured": true },
      "whatsapp": { "configured": true }
    }
  }
}
```

### Logs en Tiempo Real

```bash
# Ver logs de la Function App
func azure functionapp logstream func-acfixbot-prod

# O via Azure CLI
az webapp log tail --name func-acfixbot-prod --resource-group rg-acfixbot-prod
```

### Test de Webhook

Enviar un mensaje de prueba desde WhatsApp al numero registrado.

---

## 8. CI/CD con GitHub Actions

### Crear Workflow

```yaml
# .github/workflows/deploy.yml
name: Deploy to Azure Functions

on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  AZURE_FUNCTIONAPP_NAME: func-acfixbot-prod
  NODE_VERSION: '22.x'

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build (if needed)
        run: npm run build --if-present

      - name: Login to Azure
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Deploy to Azure Functions
        uses: Azure/functions-action@v1
        with:
          app-name: ${{ env.AZURE_FUNCTIONAPP_NAME }}
          package: .
```

### Configurar Secretos en GitHub

1. Ir a Repository → Settings → Secrets and variables → Actions
2. Agregar `AZURE_CREDENTIALS`:

```bash
# Generar credenciales
az ad sp create-for-rbac --name "github-acfixbot" --role contributor \
    --scopes /subscriptions/{subscription-id}/resourceGroups/rg-acfixbot-prod \
    --sdk-auth
```

Copiar el JSON resultante como secreto `AZURE_CREDENTIALS`.

---

## 9. Rollback y Recuperacion

### Ver Deployments Anteriores

```bash
az functionapp deployment list --name func-acfixbot-prod --resource-group rg-acfixbot-prod
```

### Rollback a Deployment Anterior

```bash
# Obtener lista de deployments
az webapp deployment list --name func-acfixbot-prod --resource-group rg-acfixbot-prod

# Redeploy desde Git (si usas continuous deployment)
az functionapp deployment source sync --name func-acfixbot-prod --resource-group rg-acfixbot-prod
```

### Backup de Base de Datos

```bash
# Exportar a bacpac
az sql db export \
    --resource-group rg-acfixbot-prod \
    --server sql-acfixbot-prod \
    --name db-acfixbot \
    --admin-user sqladmin \
    --admin-password TuPassword \
    --storage-key-type StorageAccessKey \
    --storage-key "tu-storage-key" \
    --storage-uri "https://stacfixbotprod.blob.core.windows.net/backups/backup-$(date +%Y%m%d).bacpac"
```

---

## 10. Troubleshooting

### Error: "Function not found"

```bash
# Verificar que las funciones se desplegaron
func azure functionapp list-functions func-acfixbot-prod

# Si no aparecen, reintentar deploy
func azure functionapp publish func-acfixbot-prod --force
```

### Error: "Database connection failed"

1. Verificar firewall de SQL Server:

```bash
az sql server firewall-rule create \
    --resource-group rg-acfixbot-prod \
    --server sql-acfixbot-prod \
    --name AllowAzure \
    --start-ip-address 0.0.0.0 \
    --end-ip-address 0.0.0.0
```

2. Verificar connection string en Application Settings

### Error: "Webhook verification failed"

1. Verificar que `WHATSAPP_VERIFY_TOKEN` coincide
2. Verificar que la URL es correcta (sin trailing slash)
3. Ver logs: `func azure functionapp logstream func-acfixbot-prod`

### Error: "Rate limit exceeded"

El health check tiene rate limiting. Esperar 1 minuto o verificar desde diferente IP.

### Logs no aparecen

```bash
# Habilitar Application Insights
az monitor app-insights component create \
    --app appi-acfixbot-prod \
    --location westus2 \
    --resource-group rg-acfixbot-prod

# Conectar a Function App
az functionapp config appsettings set \
    --name func-acfixbot-prod \
    --resource-group rg-acfixbot-prod \
    --settings APPINSIGHTS_INSTRUMENTATIONKEY="tu-key"
```

---

## Checklist de Deployment

- [ ] Recursos Azure creados
- [ ] Base de datos inicializada
- [ ] Variables de entorno configuradas
- [ ] Deploy exitoso
- [ ] Health check responde 200
- [ ] Webhook verificado en Meta
- [ ] Mensaje de prueba recibido y procesado
- [ ] Logs funcionando
- [ ] Backup de BD configurado (opcional)
- [ ] CI/CD configurado (opcional)

---

**Version:** 2.0.0
**Ultima actualizacion:** Enero 2026
