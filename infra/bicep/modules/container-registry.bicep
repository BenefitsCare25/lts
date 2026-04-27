// Azure Container Registry — Basic SKU is enough for Phase 1.
// Admin user is enabled to keep deploy-staging.sh simple; switch
// to managed-identity pulls when CI service principal lands.

@description('Registry name. Must be globally unique and 5–50 alphanumeric.')
param name string

@description('Azure region.')
param location string

@description('Tags applied to the resource.')
param tags object = {}

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: true
    publicNetworkAccess: 'Enabled'
    zoneRedundancy: 'Disabled'
  }
}

output loginServer string = acr.properties.loginServer
output id string = acr.id
output name string = acr.name
