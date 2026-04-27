// Container Apps managed environment — shared runtime for all
// container apps in the resource group.
//
// When logAnalyticsCustomerId/SharedKey are non-empty, the env
// streams stdout/stderr to that workspace. When both are empty,
// appLogsConfiguration is omitted entirely (the Container Apps
// API rejects destination='none' as a string and requires the
// property to be absent). Live debugging via
// `az containerapp logs show --follow` works regardless.

@description('Environment name.')
param name string

@description('Azure region.')
param location string

@description('Log Analytics workspace customer id. Empty string disables app-log collection.')
param logAnalyticsCustomerId string = ''

@description('Log Analytics workspace shared key. Empty string disables app-log collection.')
@secure()
param logAnalyticsSharedKey string = ''

@description('Tags applied to the resource.')
param tags object = {}

var collectLogs = !empty(logAnalyticsCustomerId) && !empty(logAnalyticsSharedKey)

var baseProperties = {
  workloadProfiles: [
    {
      name: 'Consumption'
      workloadProfileType: 'Consumption'
    }
  ]
  zoneRedundant: false
}

var logsProperties = collectLogs
  ? {
      appLogsConfiguration: {
        destination: 'log-analytics'
        logAnalyticsConfiguration: {
          customerId: logAnalyticsCustomerId
          sharedKey: logAnalyticsSharedKey
        }
      }
    }
  : {}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: name
  location: location
  tags: tags
  properties: union(baseProperties, logsProperties)
}

output id string = env.id
output defaultDomain string = env.properties.defaultDomain
