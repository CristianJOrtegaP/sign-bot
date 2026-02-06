// ==============================================================================
// AC FIXBOT - Application Insights Module
// Application Insights + Log Analytics Workspace
// ==============================================================================

@description('Name of the Application Insights resource')
param name string

@description('Name of the Log Analytics Workspace')
param logAnalyticsName string

@description('Azure region for resource deployment')
param location string

@description('Environment: dev, tst, prod')
@allowed(['dev', 'tst', 'prod'])
param environment string

@description('Log retention in days (30 dev, 60 tst, 90 prod)')
param retentionInDays int = environment == 'prod' ? 90 : environment == 'tst' ? 60 : 30

var tags = {
  project: 'acfixbot'
  environment: environment
}

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: name
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
    RetentionInDays: retentionInDays
  }
}

output instrumentationKey string = appInsights.properties.InstrumentationKey
output connectionString string = appInsights.properties.ConnectionString
output workspaceId string = logAnalyticsWorkspace.id
