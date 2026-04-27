// Log Analytics workspace — backs Application Insights and any
// future container-stdout collection. Per-GB pricing.

@description('Workspace name. Must be globally unique within the resource group.')
param name string

@description('Azure region.')
param location string

@description('Tags applied to the workspace.')
param tags object = {}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

output id string = workspace.id
output customerId string = workspace.properties.customerId
