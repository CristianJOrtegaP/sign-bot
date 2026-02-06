// ==============================================================================
// AC FIXBOT - Azure Maps Module
// Azure Maps Gen2 para geolocalizacion de tecnicos y clientes
// ==============================================================================

@description('Nombre base del recurso')
param name string

@description('Ubicacion del recurso')
param location string

@description('Ambiente: dev, tst, prod')
@allowed(['dev', 'tst', 'prod'])
param environment string

// Tags comunes para todos los recursos del modulo
var tags = {
  project: 'acfixbot'
  environment: environment
}

// ==============================================================================
// Azure Maps Account - Gen2
// ==============================================================================
resource mapsAccount 'Microsoft.Maps/accounts@2023-06-01' = {
  name: name
  location: location
  tags: tags
  kind: 'Gen2'
  sku: {
    name: 'G2'
  }
  properties: {
    disableLocalAuth: false
  }
}

// ==============================================================================
// Outputs
// ==============================================================================

@description('Clave primaria de Azure Maps')
output primaryKey string = mapsAccount.listKeys().primaryKey
