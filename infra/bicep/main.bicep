// =============================================================
// Insurance SaaS — Phase 1 Azure stack (entry point).
//
// Always deploys: Container Registry, Container Apps env + app.
// Optional (deploy*=true): Log Analytics + App Insights, Postgres,
// Redis, Storage (Blob), Key Vault.
//
// Default = leanest staging stack (RG + ACR + Container App).
// Flip flags on as their stories land:
//   deployPostgres        → Story S4 (schema migrations)
//   deployRedis           → Story S5 (BullMQ jobs)
//   deployStorage         → Story S29 (placement-slip uploads)
//   deployObservability   → production cutover (LA + App Insights)
//   deployKeyVault        → production cutover (rotated secrets)
//
// All resources land in southeastasia for Singapore PDPA data
// residency.
// =============================================================

targetScope = 'resourceGroup'

@description('Short identifier for the deploy environment, e.g. "staging" or "prod". Used as a suffix in resource names.')
@allowed([
  'staging'
  'prod'
])
param environmentName string

@description('Azure region. Pinned to southeastasia for PDPA data residency.')
@allowed([
  'southeastasia'
])
param location string = 'southeastasia'

@description('Container image reference for the Next.js app (registry/name:tag).')
param appImage string

// ---- Optional component flags ----------------------------------------------

@description('Deploy Log Analytics + Application Insights. Default false; debug via az containerapp logs show --follow until production.')
param deployObservability bool = false

@description('Deploy Postgres Flexible Server. Default false; required from Story S4 onwards.')
param deployPostgres bool = false

@description('Deploy Azure Cache for Redis. Default false; required from Story S5 onwards.')
param deployRedis bool = false

@description('Deploy Storage account + Blob container. Default false; required from Story S29 onwards.')
param deployStorage bool = false

@description('Deploy Key Vault. Default false; Container Apps secret bag covers Phase 1 single-app needs.')
param deployKeyVault bool = false

// ---- Postgres credentials (only used when deployPostgres=true) -------------

@description('Postgres administrator username. Ignored when deployPostgres=false.')
param postgresAdminUsername string = 'saas_admin'

@description('Postgres administrator password. Required when deployPostgres=true.')
@secure()
param postgresAdminPassword string = ''

// ---- SharePoint storage credentials (Phase 1G) -----------------------------
// All five required for the placement-slip upload path. Empty values keep
// the env vars out of the Container App so local dev / fresh stacks fall
// back to inline-marker storage instead.

@description('SharePoint app registration tenant ID.')
@secure()
param sharepointTenantId string = ''

@description('SharePoint app registration client ID.')
@secure()
param sharepointClientId string = ''

@description('SharePoint app registration client secret.')
@secure()
param sharepointClientSecret string = ''

@description('SharePoint service account UPN.')
@secure()
param sharepointServiceAccountUsername string = ''

@description('SharePoint service account password.')
@secure()
param sharepointServiceAccountPassword string = ''

// ---- Tags -------------------------------------------------------------------

@description('Resource tags.')
param tags object = {
  application: 'insurance-saas'
  environment: environmentName
  managedBy: 'bicep'
}

// Deterministic short suffix for global-uniqueness names (ACR, storage, KV).
// Uses the resource group id, so a redeploy into the same RG keeps the same suffix.
var nameSuffix = uniqueString(resourceGroup().id)
var appName = 'insurance-saas-${environmentName}'

// ---- Optional: Log Analytics + App Insights --------------------------------

module logAnalytics 'modules/log-analytics.bicep' = if (deployObservability) {
  name: 'logAnalytics'
  params: {
    name: '${appName}-logs'
    location: location
    tags: tags
  }
}

module appInsights 'modules/app-insights.bicep' = if (deployObservability) {
  name: 'appInsights'
  params: {
    name: '${appName}-appi'
    location: location
    #disable-next-line BCP318
    workspaceId: logAnalytics.outputs.id
    tags: tags
  }
}

// Workspace resource reference so we can listKeys() for Container Apps env.
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = if (deployObservability) {
  name: '${appName}-logs'
  dependsOn: [
    logAnalytics
  ]
}

// ---- Always: Container Registry + Container Apps env + app -----------------

module registry 'modules/container-registry.bicep' = {
  name: 'registry'
  params: {
    name: 'insurancesaas${environmentName}${nameSuffix}'
    location: location
    tags: tags
  }
}

resource registryRes 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
  name: 'insurancesaas${environmentName}${nameSuffix}'
  dependsOn: [
    registry
  ]
}

module containerEnv 'modules/container-env.bicep' = {
  name: 'containerEnv'
  params: {
    name: '${appName}-env'
    location: location
    #disable-next-line BCP318
    logAnalyticsCustomerId: deployObservability ? logAnalytics.outputs.customerId : ''
    #disable-next-line BCP318 BCP422
    logAnalyticsSharedKey: deployObservability ? workspace.listKeys().primarySharedKey : ''
    tags: tags
  }
}

// ---- Optional: Postgres ----------------------------------------------------

module postgres 'modules/postgres.bicep' = if (deployPostgres) {
  name: 'postgres'
  params: {
    name: '${appName}-pg-${nameSuffix}'
    location: location
    adminUsername: postgresAdminUsername
    adminPassword: postgresAdminPassword
    tags: tags
  }
}

// ---- Optional: Redis -------------------------------------------------------

module redis 'modules/redis.bicep' = if (deployRedis) {
  name: 'redis'
  params: {
    name: '${appName}-redis-${nameSuffix}'
    location: location
    tags: tags
  }
}

// ---- Optional: Storage -----------------------------------------------------

module storage 'modules/storage.bicep' = if (deployStorage) {
  name: 'storage'
  params: {
    name: 'insurancesaas${environmentName}${nameSuffix}'
    location: location
    tags: tags
  }
}

// ---- Optional: Key Vault ---------------------------------------------------

module keyVault 'modules/keyvault.bicep' = if (deployKeyVault) {
  name: 'keyVault'
  params: {
    name: 'insurancesaas-kv-${nameSuffix}'
    location: location
    tags: tags
  }
}

// ---- Always: Container App -------------------------------------------------

module containerApp 'modules/container-app.bicep' = {
  name: 'containerApp'
  params: {
    name: '${appName}-web'
    location: location
    environmentId: containerEnv.outputs.id
    image: appImage
    registryServer: registry.outputs.loginServer
    registryUsername: registryRes.listCredentials().username
    registryPassword: registryRes.listCredentials().passwords[0].value
    #disable-next-line BCP318
    databaseUrl: deployPostgres ? postgres.outputs.connectionString : ''
    #disable-next-line BCP318
    redisUrl: deployRedis ? redis.outputs.connectionString : ''
    #disable-next-line BCP318
    appInsightsConnectionString: deployObservability ? appInsights.outputs.connectionString : ''
    sharepointTenantId: sharepointTenantId
    sharepointClientId: sharepointClientId
    sharepointClientSecret: sharepointClientSecret
    sharepointServiceAccountUsername: sharepointServiceAccountUsername
    sharepointServiceAccountPassword: sharepointServiceAccountPassword
    tags: tags
  }
}

// ---- Outputs ---------------------------------------------------------------

output appUrl string = containerApp.outputs.appUrl
output registryLoginServer string = registry.outputs.loginServer
#disable-next-line BCP318
output postgresFqdn string = deployPostgres ? postgres.outputs.fqdn : ''
#disable-next-line BCP318
output keyVaultUri string = deployKeyVault ? keyVault.outputs.vaultUri : ''
#disable-next-line BCP318
output blobEndpoint string = deployStorage ? storage.outputs.blobEndpoint : ''
