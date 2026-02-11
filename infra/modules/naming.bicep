// ==============================================================================
// Sign Bot - Naming Convention Module
// Genera nombres consistentes para todos los recursos Azure
// ==============================================================================

@description('Nombre del proyecto')
param projectName string

@description('Ambiente: dev, tst, prod')
@allowed(['dev', 'tst', 'prod'])
param environment string

// Naming outputs siguiendo Azure naming conventions
// https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-naming

// NOTA: dev usa 'development' para evitar conflictos con recursos soft-deleted
// que quedaron con purge protection activo (Key Vault, etc.)
var envSuffix = environment == 'dev' ? 'development' : environment

output resourceGroupName string = 'rg-${projectName}-${envSuffix}'
output keyVaultName string = 'kv-${projectName}-${envSuffix}'
output appInsightsName string = 'appi-${projectName}-${envSuffix}'
output logAnalyticsName string = 'log-${projectName}-${envSuffix}'
output sqlServerName string = 'sql-${projectName}-${envSuffix}'
output sqlDatabaseName string = 'db-${projectName}'
output storageAccountName string = 'st${projectName}${envSuffix}'
output functionAppName string = 'func-${projectName}-${envSuffix}'
output appServicePlanName string = 'asp-${projectName}-${envSuffix}'
output redisName string = 'redis-${projectName}-${envSuffix}'
output serviceBusName string = 'sb-${projectName}-${envSuffix}'
output staticWebAppName string = 'swa-${projectName}-${envSuffix}'
