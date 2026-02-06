// ==============================================================================
// AC FIXBOT - Azure OpenAI Module
// Azure OpenAI con despliegue de modelo gpt-4o-mini
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

// Nombre del despliegue del modelo
var deploymentName = 'gpt-4o-mini'

// ==============================================================================
// Azure OpenAI Account - S0
// ==============================================================================
resource openAI 'Microsoft.CognitiveServices/accounts@2023-10-01-preview' = {
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
// Model Deployment - gpt-4o-mini (Standard)
// ==============================================================================
resource modelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-10-01-preview' = {
  parent: openAI
  name: deploymentName
  sku: {
    name: 'Standard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o-mini'
      version: '2024-07-18'
    }
  }
}

// ==============================================================================
// Outputs
// ==============================================================================

@description('Endpoint del servicio Azure OpenAI')
output endpoint string = openAI.properties.endpoint

@description('Clave primaria del servicio Azure OpenAI')
output key string = openAI.listKeys().key1

@description('Nombre del despliegue del modelo')
output deploymentName string = modelDeployment.name
