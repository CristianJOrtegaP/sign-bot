// ==============================================================================
// AC FIXBOT - Azure Service Bus Module
// Service Bus Namespace + Queue with dead letter support
// ==============================================================================

@description('Name of the Service Bus namespace')
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
  dev: 'Basic'
  tst: 'Basic'
  prod: 'Standard'
}

resource serviceBusNamespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: skuMap[environment]
    tier: skuMap[environment]
  }
}

resource queue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: 'acfixbot-messages'
  properties: {
    maxDeliveryCount: 3
    defaultMessageTimeToLive: 'P1D'
    deadLetteringOnMessageExpiration: true
    lockDuration: 'PT1M'
  }
}

var listKeysEndpoint = '${serviceBusNamespace.id}/AuthorizationRules/RootManageSharedAccessKey'

output connectionString string = listKeys(listKeysEndpoint, serviceBusNamespace.apiVersion).primaryConnectionString
output queueName string = queue.name
