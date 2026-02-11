using '../main.bicep'

param environment = 'dev'
param location = 'westus2'
param projectName = 'signbot'
param sqlAdminLogin = 'sqladmin'
param sqlAdminPassword = readEnvironmentVariable('SQL_ADMIN_PASSWORD', '')
param deployRedis = false
param deployServiceBus = true
