// Storage account + Blob container for placement-slip uploads.
// Standard LRS — sufficient for Singapore-only PDPA scope.

@description('Storage account name. Must be 3–24 lowercase alphanumeric, globally unique.')
param name string

@description('Azure region.')
param location string

@description('Blob container name for placement-slip uploads.')
param placementSlipContainerName string = 'placement-slips'

@description('Tags applied to the resource.')
param tags object = {}

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    accessTier: 'Hot'
  }

  resource blobServices 'blobServices@2023-05-01' = {
    name: 'default'
    properties: {
      deleteRetentionPolicy: {
        enabled: true
        days: 30
      }
    }

    resource placementSlips 'containers@2023-05-01' = {
      name: placementSlipContainerName
      properties: {
        publicAccess: 'None'
      }
    }
  }
}

output accountName string = account.name
output blobEndpoint string = account.properties.primaryEndpoints.blob
#disable-next-line outputs-should-not-contain-secrets
output connectionString string = 'DefaultEndpointsProtocol=https;AccountName=${account.name};AccountKey=${account.listKeys().keys[0].value};EndpointSuffix=core.windows.net'
