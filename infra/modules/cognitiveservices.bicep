// ==============================================================================
// AC FIXBOT - Cognitive Services Module
// Computer Vision (S1) + Speech Services (F0)
// ==============================================================================

@description('Nombre del recurso Computer Vision')
param name string

@description('Nombre del recurso Speech Services')
param speechName string

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
// Computer Vision - S1
// Usado para analisis de imagenes enviadas via WhatsApp
// ==============================================================================
resource computerVision 'Microsoft.CognitiveServices/accounts@2023-10-01-preview' = {
  name: name
  location: location
  tags: tags
  kind: 'ComputerVision'
  sku: {
    name: 'S1'
  }
  properties: {
    customSubDomainName: name
    publicNetworkAccess: 'Enabled'
  }
}

// ==============================================================================
// Speech Services - F0 (Free)
// Usado para transcripcion de notas de voz recibidas via WhatsApp
// ==============================================================================
resource speechServices 'Microsoft.CognitiveServices/accounts@2023-10-01-preview' = {
  name: speechName
  location: location
  tags: tags
  kind: 'SpeechServices'
  sku: {
    name: 'F0'
  }
  properties: {
    customSubDomainName: speechName
    publicNetworkAccess: 'Enabled'
  }
}

// ==============================================================================
// Outputs
// ==============================================================================

@description('Endpoint del servicio Computer Vision')
output visionEndpoint string = computerVision.properties.endpoint

@description('Clave primaria del servicio Computer Vision')
output visionKey string = computerVision.listKeys().key1

@description('Clave primaria del servicio Speech Services')
output speechKey string = speechServices.listKeys().key1

@description('Region del servicio Speech Services')
output speechRegion string = location
