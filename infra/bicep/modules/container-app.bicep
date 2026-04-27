// The Next.js Container App. Single revision, scales to zero.
// Image pulled from ACR via admin credentials; switch to managed
// identity once a service principal is provisioned.
//
// databaseUrl, redisUrl, and appInsightsConnectionString are
// optional — when empty the corresponding secret + env var are
// omitted entirely so the app boots without them. Stories S4/S5
// flip them on as the dependent infra is deployed.

@description('App name.')
param name string

@description('Azure region.')
param location string

@description('Resource id of the Container Apps managed environment.')
param environmentId string

@description('Container image reference, e.g. myacr.azurecr.io/insurance-saas-web:abc123.')
param image string

@description('ACR login server (e.g. myacr.azurecr.io).')
param registryServer string

@description('ACR username (admin user).')
param registryUsername string

@description('ACR password (admin password). Treat as secret.')
@secure()
param registryPassword string

@description('Postgres connection string. Empty string omits DATABASE_URL.')
@secure()
param databaseUrl string = ''

@description('Redis connection string. Empty string omits REDIS_URL.')
@secure()
param redisUrl string = ''

@description('Application Insights connection string. Empty string omits APPLICATIONINSIGHTS_CONNECTION_STRING.')
param appInsightsConnectionString string = ''

@description('Tags applied to the resource.')
param tags object = {}

var hasDatabase = !empty(databaseUrl)
var hasRedis = !empty(redisUrl)
var hasAppInsights = !empty(appInsightsConnectionString)

var baseSecrets = [
  {
    name: 'registry-password'
    value: registryPassword
  }
]
var dbSecret = hasDatabase
  ? [
      {
        name: 'database-url'
        value: databaseUrl
      }
    ]
  : []
var redisSecret = hasRedis
  ? [
      {
        name: 'redis-url'
        value: redisUrl
      }
    ]
  : []

var baseEnv = [
  {
    name: 'NODE_ENV'
    value: 'production'
  }
]
var dbEnv = hasDatabase
  ? [
      {
        name: 'DATABASE_URL'
        secretRef: 'database-url'
      }
    ]
  : []
var redisEnv = hasRedis
  ? [
      {
        name: 'REDIS_URL'
        secretRef: 'redis-url'
      }
    ]
  : []
var aiEnv = hasAppInsights
  ? [
      {
        name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
        value: appInsightsConnectionString
      }
    ]
  : []

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: registryServer
          username: registryUsername
          passwordSecretRef: 'registry-password'
        }
      ]
      secrets: concat(baseSecrets, dbSecret, redisSecret)
    }
    template: {
      containers: [
        {
          name: 'web'
          image: image
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: concat(baseEnv, dbEnv, redisEnv, aiEnv)
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 3
      }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
