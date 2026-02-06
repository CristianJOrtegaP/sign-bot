using '../main.bicep'

param environment = 'tst'
param location = 'eastus'
param projectName = 'acfixbot'
param sqlAdminLogin = 'sqladmin'
param sqlAdminPassword = readEnvironmentVariable('SQL_ADMIN_PASSWORD', '')
param deployOpenAI = true
param deployWhisper = true
param deployRedis = false
param deployServiceBus = false
