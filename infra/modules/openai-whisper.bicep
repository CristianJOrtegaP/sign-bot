// ==============================================================================
// AC FIXBOT - Azure OpenAI Whisper Module
// Azure OpenAI con despliegue de modelo Whisper para transcripcion de audio
// Desplegado en region separada (northcentralus) por disponibilidad
// ==============================================================================

@description('Nombre base del recurso')
param name string

@description('Ubicacion del recurso (northcentralus para Whisper)')
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
// Azure OpenAI Account - S0 (cuenta separada para Whisper)
// ==============================================================================
resource openAIWhisper 'Microsoft.CognitiveServices/accounts@2023-10-01-preview' = {
  name: name
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: name
    publicNetworkAccess: 'Enabled'
  }
}

// ==============================================================================
// Model Deployment - Whisper (Standard)
// ==============================================================================
resource whisperDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-10-01-preview' = {
  parent: openAIWhisper
  name: 'whisper'
  sku: {
    name: 'Standard'
    capacity: 1
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'whisper'
      version: '001'
    }
  }
}

// ==============================================================================
// Outputs
// ==============================================================================

@description('Endpoint del servicio Azure OpenAI (Whisper)')
output endpoint string = openAIWhisper.properties.endpoint

@description('Clave primaria del servicio Azure OpenAI (Whisper)')
output key string = openAIWhisper.listKeys().key1

@description('Nombre del despliegue del modelo Whisper')
output deploymentName string = whisperDeployment.name
