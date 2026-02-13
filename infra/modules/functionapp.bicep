// ==============================================================================
// Sign Bot - Function App Module
// Azure Function App with App Service Plan (Consumption Y1)
// Runtime: Node.js 22, Linux, Azure Functions v4
// ==============================================================================

@description('Nombre del Function App')
param name string

@description('Nombre del App Service Plan')
param appServicePlanName string = ''

@description('Ubicacion del recurso')
param location string

@description('Ambiente: dev, tst, prod')
@allowed(['dev', 'tst', 'prod'])
param environment string

@description('Connection string de Application Insights')
param appInsightsConnectionString string

@description('Connection string de Storage Account')
param storageConnectionString string

@description('URI del Key Vault (e.g. https://kv-signbot-dev.vault.azure.net/)')
param keyVaultUri string

@description('Desplegar Redis (habilita referencia Key Vault)')
param deployRedis bool = false

@description('Desplegar Service Bus (habilita referencia Key Vault)')
param deployServiceBus bool = false

// Tags comunes para todos los recursos del modulo
var tags = {
  project: 'signbot'
  environment: environment
}

// dev/prod: B1 (Basic) — Always On elimina cold starts (~$13/mo)
// tst: Y1 (Consumption/Dynamic) — requiere Pay-As-You-Go (~$0/mo para <1M ejecuciones)
var skuMap = {
  dev: { name: 'B1', tier: 'Basic' }
  tst: { name: 'Y1', tier: 'Dynamic' }
  prod: { name: 'B1', tier: 'Basic' }
}
var skuName = skuMap[environment].name
var skuTier = skuMap[environment].tier

// ==============================================================================
// App Service Plan
// ==============================================================================
var aspName = !empty(appServicePlanName) ? appServicePlanName : 'asp-${name}'

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: aspName
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    reserved: true // Required for Linux
  }
}

// ==============================================================================
// Function App
// ==============================================================================
resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: name
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    reserved: true
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'Node|22'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      // Always On mejora confiabilidad y elimina cold starts (solo B1+, no Y1/Dynamic)
      alwaysOn: skuTier != 'Dynamic'
      appSettings: [
        // ----------------------------------------------------------------
        // Azure Functions Runtime
        // ----------------------------------------------------------------
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~22'
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        // Run From Package: Azure monta el zip como filesystem de solo lectura
        // Elimina el rsync de ~55K archivos y reduce el deploy de ~15min a ~30s
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        // ----------------------------------------------------------------
        // Storage (requerido por Azure Functions)
        // ----------------------------------------------------------------
        {
          name: 'AzureWebJobsStorage'
          value: storageConnectionString
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: storageConnectionString
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower(name)
        }
        // Blob Storage para documentos (misma Storage Account)
        {
          name: 'BLOB_CONNECTION_STRING'
          value: storageConnectionString
        }
        // ----------------------------------------------------------------
        // Application Insights
        // ----------------------------------------------------------------
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        // ----------------------------------------------------------------
        // Environment
        // ----------------------------------------------------------------
        {
          name: 'ENVIRONMENT'
          value: environment
        }
        {
          name: 'NODE_ENV'
          value: environment == 'prod' ? 'production' : 'development'
        }
        // ----------------------------------------------------------------
        // Key Vault URI
        // ----------------------------------------------------------------
        {
          name: 'KEY_VAULT_URI'
          value: keyVaultUri
        }
        // ----------------------------------------------------------------
        // SQL Database (referencia a Key Vault)
        // ----------------------------------------------------------------
        {
          name: 'SQL_CONNECTION_STRING'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/SQL-CONNECTION-STRING/)'
        }
        // ----------------------------------------------------------------
        // WhatsApp / Meta (referencias a Key Vault)
        // ----------------------------------------------------------------
        {
          name: 'WHATSAPP_TOKEN'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/WHATSAPP-TOKEN/)'
        }
        {
          name: 'WHATSAPP_PHONE_ID'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/WHATSAPP-PHONE-ID/)'
        }
        {
          name: 'WHATSAPP_VERIFY_TOKEN'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/WHATSAPP-VERIFY-TOKEN/)'
        }
        {
          name: 'WHATSAPP_APP_SECRET'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/WHATSAPP-APP-SECRET/)'
        }
        // ----------------------------------------------------------------
        // DocuSign (referencias a Key Vault para secretos)
        // ----------------------------------------------------------------
        {
          name: 'DOCUSIGN_INTEGRATION_KEY'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/DOCUSIGN-INTEGRATION-KEY/)'
        }
        {
          name: 'DOCUSIGN_USER_ID'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/DOCUSIGN-USER-ID/)'
        }
        {
          name: 'DOCUSIGN_ACCOUNT_ID'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/DOCUSIGN-ACCOUNT-ID/)'
        }
        {
          name: 'DOCUSIGN_BASE_URL'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/DOCUSIGN-BASE-URL/)'
        }
        {
          name: 'DOCUSIGN_RSA_PRIVATE_KEY'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/DOCUSIGN-RSA-PRIVATE-KEY/)'
        }
        {
          name: 'DOCUSIGN_WEBHOOK_SECRET'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/DOCUSIGN-WEBHOOK-SECRET/)'
        }
        {
          name: 'DOCUSIGN_ENVELOPE_EXPIRATION_DAYS'
          value: '30'
        }
        // ----------------------------------------------------------------
        // Firma (configuracion de recordatorios y housekeeping)
        // ----------------------------------------------------------------
        {
          name: 'FIRMA_REMINDER_HOURS_CLIENTE'
          value: '48'
        }
        {
          name: 'FIRMA_MAX_RECORDATORIOS_CLIENTE'
          value: '3'
        }
        {
          name: 'FIRMA_REMINDER_DAYS_SAP'
          value: '7'
        }
        {
          name: 'FIRMA_HOUSEKEEPING_DAYS'
          value: '30'
        }
        {
          name: 'FIRMA_TIMER_SCHEDULE'
          value: '0 0 9 * * *'
        }
        // Session cleanup: cada 5 minutos
        {
          name: 'TIMER_SCHEDULE'
          value: '0 */5 * * * *'
        }
        // ----------------------------------------------------------------
        // Teams Webhook
        // ----------------------------------------------------------------
        {
          name: 'TEAMS_WEBHOOK_URL'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/TEAMS-WEBHOOK-URL/)'
        }
        // ----------------------------------------------------------------
        // Admin
        // ----------------------------------------------------------------
        {
          name: 'ADMIN_RATE_LIMIT_MAX'
          value: '60'
        }
        // ----------------------------------------------------------------
        // Redis Cache (opcional, referencia a Key Vault)
        // ----------------------------------------------------------------
        {
          name: 'REDIS_CONNECTION_STRING'
          value: deployRedis
            ? '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/REDIS-CONNECTION-STRING/)'
            : ''
        }
        // ----------------------------------------------------------------
        // Service Bus (opcional, referencia a Key Vault)
        // ----------------------------------------------------------------
        {
          name: 'SERVICEBUS_CONNECTION_STRING'
          value: deployServiceBus
            ? '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/SERVICE-BUS-CONNECTION-STRING/)'
            : ''
        }
      ]
    }
  }
}

// ==============================================================================
// Outputs
// ==============================================================================

@description('Nombre del Function App desplegado')
output functionAppName string = functionApp.name

@description('Principal ID de la identidad administrada del Function App')
output principalId string = functionApp.identity.principalId

@description('Hostname por defecto del Function App')
output defaultHostName string = functionApp.properties.defaultHostName
