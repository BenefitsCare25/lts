# Azure infrastructure (Bicep)

Phase 1 infrastructure for the insurance-saas platform. All resources land in `southeastasia` (Singapore) per the PDPA data-residency requirement in `docs/PHASE_1_BUILD_PLAN_v2.md` §7 and `CLAUDE.md`.

## Layout

```
infra/bicep/
  main.bicep                 entry point — composes the modules below
  staging.parameters.json    parameter file for the staging environment
  modules/
    log-analytics.bicep      Log Analytics workspace (App Insights backend)
    app-insights.bicep       Application Insights (telemetry)
    container-env.bicep      Container Apps managed environment
    container-app.bicep      The Next.js Container App
    container-registry.bicep ACR for the app image
    postgres.bicep           Azure Database for PostgreSQL Flexible Server
    redis.bicep              Azure Cache for Redis
    storage.bicep            Storage account + Blob container
    keyvault.bicep           Key Vault for secrets (WorkOS, etc.)
```

## Phased deployment — what's on by default vs. opt-in

`main.bicep` exposes five `deployX` boolean flags. The default `staging.parameters.json` ships the **leanest** stack — only what's needed to host a running container. Other modules turn on as their stories land.

| Flag | Default | Turns on | Cost / month |
|---|---|---|---|
| (always) | — | RG + ACR Basic + Container Apps env + Container App | ~S$7 |
| `deployPostgres` | `false` | Postgres Flexible Server `Standard_B1ms` + 32 GB storage + 7-day backup | +S$25–30 |
| `deployRedis` | `false` | Azure Cache for Redis Basic C0 (250 MB) | +S$22 |
| `deployStorage` | `false` | Standard LRS storage account + `placement-slips` Blob container | +S$0–2 |
| `deployObservability` | `false` | Log Analytics + Application Insights | +S$0–5 |
| `deployKeyVault` | `false` | Key Vault Standard, RBAC | +S$0–1 |

### When to flip each on

- **`deployPostgres` → Story S4** (`Database baseline + Prisma schema`). Required from the first migration onwards.
- **`deployRedis` → Story S5** (`Background job queue (BullMQ + Redis)`). Required when the worker scaffold lands.
- **`deployStorage` → Story S29** (`Upload + parser registry`). Or replaced by SharePoint + Microsoft Graph integration if that's the path; ADR-worthy decision.
- **`deployObservability`, `deployKeyVault` → production cutover.** Phase 1 staging debugs via `az containerapp logs show --follow`; Container Apps' built-in secret bag covers single-app secret management.

### Cost summary

| Stack | Idle | Under load |
|---|---|---|
| **Leanest (default)** | **~S$7/mo** | ~S$10/mo |
| + Postgres (post-S4) | ~S$37/mo | ~S$45/mo |
| + Postgres + Redis (post-S5) | ~S$59/mo | ~S$70/mo |
| Full (everything on) | ~S$65–70/mo | ~S$110–200/mo |

## How to deploy

Prerequisites (one-time, owed by the human per the bootstrap log):

1. Azure subscription with Owner or Contributor role.
2. Resource group `insurance-saas-staging-rg` in `southeastasia` (or whatever `AZURE_RESOURCE_GROUP` is set to). The deploy script creates it if absent.
3. Resource providers registered: `Microsoft.App`, `Microsoft.ContainerRegistry`. Plus `Microsoft.DBforPostgreSQL` once `deployPostgres=true`, `Microsoft.Cache` once `deployRedis=true`, `Microsoft.KeyVault` once `deployKeyVault=true`.
4. Service principal for CI deploys (Story S1 close-out — not yet provisioned).

Once those are set up:

```bash
./scripts/deploy-staging.sh
```

The script wraps `az deployment group create` against `main.bicep` with `staging.parameters.json`, then builds and pushes the container image, then bumps the Container App revision.

`POSTGRES_ADMIN_PASSWORD` is only required when `deployPostgres=true` in the parameters file.

## Validation

Compile the templates without deploying:

```bash
az bicep build --file infra/bicep/main.bicep
```

This is run in CI on every change touching `infra/bicep/**`.

## What's deferred to later stories or production

- **Production parameters file** — Phase 2 multi-environment work. For now staging is the only environment.
- **Network isolation** (private endpoints, VNet) — only meaningful once we have customer data; Phase 1 ships public-with-firewall.
- **Backup and DR** — relies on Postgres Flexible Server's built-in 7-day point-in-time restore in Phase 1; hardened in Phase 2.
- **Bicep What-If checks in CI** — added once the staging subscription exists.
- **Managed-identity ACR pulls** — Phase 1 uses ACR admin user; switch to MI once the CI service principal lands.
