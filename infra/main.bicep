// ==============================================================================
// Sign Bot - Main Infrastructure Orchestrator
// Deploya todos los recursos Azure para el chatbot de firma digital via WhatsApp
//
// Costo estimado:
//   dev:  ~$15-20 USD/mes  (B1, Basic SQL)
//   prod: ~$20-35 USD/mes  (Y1, Basic SQL)
// ==============================================================================

targetScope = 'subscription'

// ==============================================================================
// PARAMETERS
// ==============================================================================

@description('Ambiente de deployment')
@allowed(['dev', 'tst', 'prod'])
param environment string

@description('Region principal de Azure')
param location string = 'eastus'

@description('Nombre del proyecto')
param projectName string = 'signbot'

// NOTA: dev usa 'development' para evitar conflictos con recursos soft-deleted
// que quedaron con purge protection activo (Key Vault, etc.)
var envSuffix = environment == 'dev' ? 'development' : environment

@description('Login de administrador SQL')
param sqlAdminLogin string = 'sqladmin'

@description('Password de administrador SQL')
@secure()
param sqlAdminPassword string

@description('Desplegar Azure Cache for Redis (solo habilitar si >1000 usuarios/dia)')
param deployRedis bool = false

@description('Desplegar Azure Service Bus (solo habilitar para procesamiento event-driven)')
param deployServiceBus bool = false

// ==============================================================================
// RESOURCE GROUP
// ==============================================================================

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${projectName}-${envSuffix}'
  location: location
  tags: {
    project: projectName
    environment: environment
    managedBy: 'bicep'
  }
}

// ==============================================================================
// NAMING CONVENTION
// ==============================================================================

module naming 'modules/naming.bicep' = {
  name: 'naming-${envSuffix}'
  scope: rg
  params: {
    projectName: projectName
    environment: environment
  }
}

// ==============================================================================
// CORE INFRASTRUCTURE (always deployed)
// ==============================================================================

// Log Analytics + Application Insights
module appInsights 'modules/appinsights.bicep' = {
  name: 'appinsights-${envSuffix}'
  scope: rg
  params: {
    name: naming.outputs.appInsightsName
    logAnalyticsName: naming.outputs.logAnalyticsName
    location: location
    environment: environment
  }
}

// Storage Account + Blob Container
module storage 'modules/storage.bicep' = {
  name: 'storage-${envSuffix}'
  scope: rg
  params: {
    name: naming.outputs.storageAccountName
    location: location
    environment: environment
  }
}

// SQL Server + Database
module sql 'modules/sql.bicep' = {
  name: 'sql-${envSuffix}'
  scope: rg
  params: {
    name: naming.outputs.sqlServerName
    databaseName: naming.outputs.sqlDatabaseName
    location: location
    adminLogin: sqlAdminLogin
    adminPassword: sqlAdminPassword
    environment: environment
  }
}

// Function App + App Service Plan (Y1 Consumption)
// Se despliega ANTES del Key Vault para obtener el principalId
module functionApp 'modules/functionapp.bicep' = {
  name: 'functionapp-${envSuffix}'
  scope: rg
  params: {
    name: naming.outputs.functionAppName
    appServicePlanName: naming.outputs.appServicePlanName
    location: location
    environment: environment
    appInsightsConnectionString: appInsights.outputs.connectionString
    storageConnectionString: storage.outputs.connectionString
    keyVaultUri: 'https://${naming.outputs.keyVaultName}${az.environment().suffixes.keyvaultDns}/'
    deployRedis: deployRedis
    deployServiceBus: deployServiceBus
  }
}

// Key Vault (depende de Function App para asignar RBAC a Managed Identity)
module keyVault 'modules/keyvault.bicep' = {
  name: 'keyvault-${envSuffix}'
  scope: rg
  params: {
    name: naming.outputs.keyVaultName
    location: location
    environment: environment
    functionAppPrincipalId: functionApp.outputs.principalId
  }
}

// ==============================================================================
// SCALABILITY RESOURCES (opt-in via parameters)
// No se despliegan por defecto — habilitar solo cuando el volumen lo requiera
// Redis: ~$16-53/mo | Service Bus: ~$0.05-10/mo
// ==============================================================================

// Azure Cache for Redis
module redis 'modules/redis.bicep' = if (deployRedis) {
  name: 'redis-${envSuffix}'
  scope: rg
  params: {
    name: naming.outputs.redisName
    location: location
    environment: environment
  }
}

// Azure Service Bus
module serviceBus 'modules/servicebus.bicep' = if (deployServiceBus) {
  name: 'servicebus-${envSuffix}'
  scope: rg
  params: {
    name: naming.outputs.serviceBusName
    location: location
    environment: environment
  }
}

// ==============================================================================
// FRONTEND (always deployed)
// ==============================================================================

module staticWebApp 'modules/staticwebapp.bicep' = {
  name: 'swa-${envSuffix}'
  scope: rg
  params: {
    name: naming.outputs.staticWebAppName
    location: 'eastus2' // SWA limited regions
    environment: environment
  }
}

// ==============================================================================
// OUTPUTS
// ==============================================================================

output resourceGroupName string = rg.name
output functionAppName string = functionApp.outputs.functionAppName
output functionAppHostname string = functionApp.outputs.defaultHostName
output sqlServerFqdn string = sql.outputs.serverFqdn
output storageEndpoint string = storage.outputs.primaryEndpoint
output appInsightsKey string = appInsights.outputs.instrumentationKey
output staticWebAppHostname string = staticWebApp.outputs.defaultHostname
