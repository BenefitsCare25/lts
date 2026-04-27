// Azure Cache for Redis — Basic C0 (250 MB). Used by BullMQ.

@description('Redis cache name. Must be globally unique.')
param name string

@description('Azure region.')
param location string

@description('Tags applied to the resource.')
param tags object = {}

resource redis 'Microsoft.Cache/redis@2024-03-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'Basic'
      family: 'C'
      capacity: 0
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    redisVersion: '6'
  }
}

// Allow all Azure-internal services (0.0.0.0 → 0.0.0.0 is the Azure "Allow Azure services" rule).
// Without this, Container Apps cannot reach the Redis endpoint even with publicNetworkAccess enabled.
resource allowAzureServices 'Microsoft.Cache/redis/firewallRules@2024-03-01' = {
  parent: redis
  name: 'AllowAzureServices'
  properties: {
    startIP: '0.0.0.0'
    endIP: '0.0.0.0'
  }
}

output hostName string = redis.properties.hostName
output sslPort int = redis.properties.sslPort
// rediss:// scheme tells ioredis to use TLS — required by Azure Cache for Redis.
#disable-next-line outputs-should-not-contain-secrets
output connectionString string = 'rediss://:${redis.listKeys().primaryKey}@${redis.properties.hostName}:${redis.properties.sslPort}'
