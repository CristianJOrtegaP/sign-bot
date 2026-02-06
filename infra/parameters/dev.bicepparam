using '../main.bicep'

param environment = 'dev'
param location = 'westus2'
param projectName = 'acfixbot'
param sqlAdminLogin = 'sqladmin'
param sqlAdminPassword = readEnvironmentVariable('SQL_ADMIN_PASSWORD', '')
param deployOpenAI = true
param deployWhisper = true
param deployRedis = false
param deployServiceBus = true
