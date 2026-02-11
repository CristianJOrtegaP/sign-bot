using '../main.bicep'

param environment = 'tst'
param location = 'eastus'
param projectName = 'signbot'
param sqlAdminLogin = 'sqladmin'
param sqlAdminPassword = readEnvironmentVariable('SQL_ADMIN_PASSWORD', '')
param deployRedis = false
param deployServiceBus = false
