// Key Vault — RBAC-authorised. Holds WorkOS API key, Postgres
// password, Redis primary key. Container Apps reads via secret
// references once managed identity is provisioned (Phase 2).

@description('Vault name. Must be globally unique, 3–24 chars.')
param name string

@description('Azure region.')
param location string

@description('AAD tenant id that owns the vault.')
param tenantId string = subscription().tenantId

@description('Tags applied to the resource.')
param tags object = {}

resource vault 'Microsoft.KeyVault/vaults@2024-04-01-preview' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

output vaultUri string = vault.properties.vaultUri
output id string = vault.id
