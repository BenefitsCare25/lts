// Application Insights (workspace-based) — telemetry sink for the
// Next.js app. Connection string is surfaced as APPLICATIONINSIGHTS_CONNECTION_STRING.

@description('App Insights instance name.')
param name string

@description('Azure region.')
param location string

@description('Resource id of the Log Analytics workspace this instance is bound to.')
param workspaceId string

@description('Tags applied to the resource.')
param tags object = {}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: name
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspaceId
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

output connectionString string = appInsights.properties.ConnectionString
output instrumentationKey string = appInsights.properties.InstrumentationKey
