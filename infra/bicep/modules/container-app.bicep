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

@description('NextAuth signing secret. Generated once; rotating invalidates all sessions. Empty string omits AUTH_SECRET — login will fail in production.')
@secure()
param authSecret string = ''

@description('AUTH_TRUST_HOST = true tells NextAuth to trust the X-Forwarded-Host header from Container Apps ingress. Required in any reverse-proxied production deploy.')
param authTrustHost bool = true

// SharePoint storage credentials (Phase 1G — placement-slip uploads).
// Five values together; presence of `sharepointTenantId` is the gate
// because all five are required for the ROPC delegated-auth flow.
// Marked @secure() so values stay masked in deployment logs.
@description('Azure AD tenant ID for the SharePoint app registration. Empty string omits the SharePoint env vars.')
@secure()
param sharepointTenantId string = ''

@description('App registration client ID with Microsoft Graph delegated permissions.')
@secure()
param sharepointClientId string = ''

@description('App registration client secret.')
@secure()
param sharepointClientSecret string = ''

@description('Service account UPN (e.g. BenefitsCare@inspro.com.sg) used by the ROPC flow.')
@secure()
param sharepointServiceAccountUsername string = ''

@description('Service account password.')
@secure()
param sharepointServiceAccountPassword string = ''

@description('Tags applied to the resource.')
param tags object = {}

var hasDatabase = !empty(databaseUrl)
var hasRedis = !empty(redisUrl)
var hasAppInsights = !empty(appInsightsConnectionString)
var hasSharepoint = !empty(sharepointTenantId)
var hasAuthSecret = !empty(authSecret)

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
var sharepointSecrets = hasSharepoint
  ? [
      {
        name: 'sharepoint-tenant-id'
        value: sharepointTenantId
      }
      {
        name: 'sharepoint-client-id'
        value: sharepointClientId
      }
      {
        name: 'sharepoint-client-secret'
        value: sharepointClientSecret
      }
      {
        name: 'sharepoint-service-account-username'
        value: sharepointServiceAccountUsername
      }
      {
        name: 'sharepoint-service-account-password'
        value: sharepointServiceAccountPassword
      }
    ]
  : []
var authSecretSecret = hasAuthSecret
  ? [
      {
        name: 'auth-secret'
        value: authSecret
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
var sharepointEnv = hasSharepoint
  ? [
      {
        name: 'AZURE_TENANT_ID'
        secretRef: 'sharepoint-tenant-id'
      }
      {
        name: 'AZURE_CLIENT_ID'
        secretRef: 'sharepoint-client-id'
      }
      {
        name: 'AZURE_CLIENT_SECRET'
        secretRef: 'sharepoint-client-secret'
      }
      {
        name: 'AZURE_SERVICE_ACCOUNT_USERNAME'
        secretRef: 'sharepoint-service-account-username'
      }
      {
        name: 'AZURE_SERVICE_ACCOUNT_PASSWORD'
        secretRef: 'sharepoint-service-account-password'
      }
    ]
  : []
var authEnv = concat(
  hasAuthSecret
    ? [
        {
          name: 'AUTH_SECRET'
          secretRef: 'auth-secret'
        }
      ]
    : [],
  authTrustHost
    ? [
        {
          name: 'AUTH_TRUST_HOST'
          value: 'true'
        }
      ]
    : []
)

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
      secrets: concat(baseSecrets, dbSecret, redisSecret, sharepointSecrets, authSecretSecret)
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
          env: concat(baseEnv, dbEnv, redisEnv, aiEnv, sharepointEnv, authEnv)
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
