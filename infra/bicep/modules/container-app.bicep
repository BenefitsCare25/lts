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

@description('AES-256-GCM master key for application-level encryption (TenantAiProvider keys, future BYOK secrets). Generated once; rotating it makes existing encrypted rows undecryptable. Empty string omits APP_SECRET_KEY — extraction features will fail in production.')
@secure()
param appSecretKey string = ''

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

@description('Minimum number of replicas. Set to 1 to prevent cold starts; 0 allows scale-to-zero.')
param minReplicas int = 0

@description('Tags applied to the resource.')
param tags object = {}

var hasDatabase = !empty(databaseUrl)
var hasRedis = !empty(redisUrl)
var hasAppInsights = !empty(appInsightsConnectionString)
var hasSharepoint = !empty(sharepointTenantId)
var hasAuthSecret = !empty(authSecret)
var hasAppSecretKey = !empty(appSecretKey)

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
var authSecrets = hasAuthSecret
  ? [
      {
        name: 'auth-secret'
        value: authSecret
      }
    ]
  : []
var appSecretKeySecrets = hasAppSecretKey
  ? [
      {
        name: 'app-secret-key'
        value: appSecretKey
      }
    ]
  : []
// Application Insights connection string is set as a Container App secret
// (rather than a plain env value) so its rotation goes through the same
// secret-update flow as everything else.
var aiSecrets = hasAppInsights
  ? [
      {
        name: 'appinsights-connection-string'
        value: appInsightsConnectionString
      }
    ]
  : []

// AUTH_TRUST_HOST tells NextAuth to trust X-Forwarded-Host from Container Apps
// ingress; without it, NextAuth rejects every request behind the reverse proxy.
var baseEnv = [
  {
    name: 'NODE_ENV'
    value: 'production'
  }
  {
    name: 'AUTH_TRUST_HOST'
    value: 'true'
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
        secretRef: 'appinsights-connection-string'
      }
    ]
  : []
var appSecretKeyEnv = hasAppSecretKey
  ? [
      {
        name: 'APP_SECRET_KEY'
        secretRef: 'app-secret-key'
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
var authEnv = hasAuthSecret
  ? [
      {
        name: 'AUTH_SECRET'
        secretRef: 'auth-secret'
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
      secrets: concat(
        baseSecrets,
        dbSecret,
        redisSecret,
        sharepointSecrets,
        authSecrets,
        appSecretKeySecrets,
        aiSecrets
      )
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
          env: concat(
            baseEnv,
            dbEnv,
            redisEnv,
            aiEnv,
            sharepointEnv,
            authEnv,
            appSecretKeyEnv
          )
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: 3
      }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
