// ==============================================================================
// AC FIXBOT - Static Web App Module
// Azure Static Web App para el panel de administracion (frontend)
// ==============================================================================

@description('Nombre base del recurso')
param name string

// Azure Static Web Apps tiene regiones limitadas; se fuerza eastus2
@description('Ubicacion del recurso (ignorada; SWA usa eastus2)')
param location string = 'eastus2'

@description('Ambiente: dev, tst, prod')
@allowed(['dev', 'tst', 'prod'])
param environment string

// Tags comunes para todos los recursos del modulo
var tags = {
  project: 'acfixbot'
  environment: environment
}

// ==============================================================================
// Static Web App - Free tier
// ==============================================================================
resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: name
  location: 'eastus2'
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    buildProperties: {
      appLocation: '/frontend'
    }
  }
}

// ==============================================================================
// Outputs
// ==============================================================================

@description('Hostname por defecto del Static Web App')
output defaultHostname string = staticWebApp.properties.defaultHostname

@description('ID del recurso Static Web App')
output id string = staticWebApp.id
