// ==============================================================================
// AC FIXBOT - Key Vault Module
// Azure Key Vault with RBAC authorization and Function App access
// ==============================================================================

@description('Name of the Key Vault resource')
param name string

@description('Azure region for resource deployment')
param location string

@description('Environment: dev, tst, prod')
@allowed(['dev', 'tst', 'prod'])
param environment string

@description('Principal ID of the Function App managed identity to grant secret access')
param functionAppPrincipalId string

var tags = {
  project: 'acfixbot'
  environment: environment
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    // NOTA: softDeleteRetentionInDays NO se puede reducir una vez creado con purge protection.
    // Dejamos 90 para todos para evitar conflictos con vaults recuperados.
    softDeleteRetentionInDays: 90
    // NOTA: purge protection es IRREVERSIBLE — una vez habilitado no se puede desactivar.
    // Lo dejamos true para todos los ambientes para evitar errores en re-deploys.
    enablePurgeProtection: true
  }
}

// Key Vault Secrets User permite get+list de secretos via RBAC
resource functionAppSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, functionAppPrincipalId, '4633458b-17de-408a-b874-0445c86b69e6')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User
    )
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output keyVaultId string = keyVault.id
