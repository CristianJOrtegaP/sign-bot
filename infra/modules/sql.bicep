// ==============================================================================
// AC FIXBOT - Azure SQL Module
// Azure SQL Server + Database with environment-based SKU
// ==============================================================================

@description('Name of the SQL Server resource')
param name string

@description('Name of the SQL Database')
param databaseName string

@description('Azure region for resource deployment')
param location string

@description('Environment: dev, tst, prod')
@allowed(['dev', 'tst', 'prod'])
param environment string

@description('SQL Server administrator login')
param adminLogin string

@secure()
@description('SQL Server administrator password')
param adminPassword string

var tags = {
  project: 'acfixbot'
  environment: environment
}

// Basic 5 DTU soporta ~16K transacciones/hora — suficiente para 200+ reportes/dia
// Para escalar a 500+ reportes/dia, subir prod a S0 (10 DTU, ~$15/mo)
var skuMap = {
  dev: {
    name: 'Basic'
    tier: 'Basic'
    capacity: 5
  }
  tst: {
    name: 'Basic'
    tier: 'Basic'
    capacity: 5
  }
  prod: {
    name: 'Basic'
    tier: 'Basic'
    capacity: 5
  }
}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: name
  location: location
  tags: tags
  properties: {
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    version: '12.0'
  }
}

// SEGURIDAD: 0.0.0.0 permite acceso desde CUALQUIER servicio Azure (incluye otros tenants).
// Aceptable para <500 reportes/dia con password fuerte + TDE habilitado.
// TODO(escala): Migrar a Private Endpoints cuando el volumen supere 500 reportes/dia
//   o cuando se manejen datos sensibles (PII, financieros).
resource firewallRule 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAllAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: databaseName
  location: location
  tags: tags
  sku: {
    name: skuMap[environment].name
    tier: skuMap[environment].tier
    capacity: skuMap[environment].capacity
  }
  properties: {}
}

resource tde 'Microsoft.Sql/servers/databases/transparentDataEncryption@2023-08-01-preview' = {
  parent: sqlDatabase
  name: 'current'
  properties: {
    state: 'Enabled'
  }
}

// No emitir connection string con password en outputs (visible en deployment history)
// deploy.sh construye el connection string y lo guarda directo en Key Vault
output serverFqdn string = sqlServer.properties.fullyQualifiedDomainName
output databaseName string = sqlDatabase.name
