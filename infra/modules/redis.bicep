// ==============================================================================
// AC FIXBOT - Azure Cache for Redis Module
// Redis Cache with TLS enforcement and environment-based SKU
// ==============================================================================

@description('Name of the Redis Cache resource')
param name string

@description('Azure region for resource deployment')
param location string

@description('Environment: dev, tst, prod')
@allowed(['dev', 'tst', 'prod'])
param environment string

var tags = {
  project: 'acfixbot'
  environment: environment
}

var skuMap = {
  dev: {
    name: 'Basic'
    family: 'C'
    capacity: 0
  }
  tst: {
    name: 'Basic'
    family: 'C'
    capacity: 0
  }
  prod: {
    name: 'Standard'
    family: 'C'
    capacity: 1
  }
}

resource redisCache 'Microsoft.Cache/redis@2023-08-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      name: skuMap[environment].name
      family: skuMap[environment].family
      capacity: skuMap[environment].capacity
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    redisConfiguration: {}
  }
}

output hostName string = redisCache.properties.hostName
output port int = redisCache.properties.sslPort
output primaryKey string = redisCache.listKeys().primaryKey
output connectionString string = '${redisCache.properties.hostName}:${redisCache.properties.sslPort},password=${redisCache.listKeys().primaryKey},ssl=True,abortConnect=False'
