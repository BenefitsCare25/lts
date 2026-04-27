// Azure Database for PostgreSQL Flexible Server.
// Burstable B1ms (1 vCPU, 2 GB RAM). 7-day backup retention.
// Public network access with firewall — Phase 2 layers VNet integration.

@description('Server name. Must be globally unique within the region.')
param name string

@description('Azure region.')
param location string

@description('Postgres administrator login.')
param adminUsername string

@description('Postgres administrator password. Treat as secret.')
@secure()
param adminPassword string

@description('Default database name created on the server.')
param databaseName string = 'insurance_saas'

@description('Tags applied to the resource.')
param tags object = {}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: adminUsername
    administratorLoginPassword: adminPassword
    storage: {
      storageSizeGB: 32
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }

  resource db 'databases@2024-08-01' = {
    name: databaseName
    properties: {
      charset: 'UTF8'
      collation: 'en_US.utf8'
    }
  }

  // Allow Azure-internal services (e.g. Container Apps) to reach the server.
  // Replace with explicit subnet rules once VNet integration lands.
  resource allowAzure 'firewallRules@2024-08-01' = {
    name: 'AllowAzureServices'
    properties: {
      startIpAddress: '0.0.0.0'
      endIpAddress: '0.0.0.0'
    }
  }
}

output fqdn string = postgres.properties.fullyQualifiedDomainName
#disable-next-line outputs-should-not-contain-secrets
output connectionString string = 'postgresql://${adminUsername}:${adminPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'
