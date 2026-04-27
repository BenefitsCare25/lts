#!/usr/bin/env bash
# =============================================================
# scripts/deploy-staging.sh
#
# Deploys the staging environment to Azure:
#   1. validates az login + subscription
#   2. ensures resource group exists in southeastasia
#   3. builds + pushes the Next.js container image to ACR
#   4. runs az deployment group create against infra/bicep/main.bicep
#      with infra/bicep/staging.parameters.json
#   5. prints the resulting app URL
#
# Idempotent — safe to re-run. Each run produces a new revision
# of the Container App tagged by short git SHA.
#
# Required environment (set in CI or your shell before running):
#   AZURE_SUBSCRIPTION_ID    target subscription
#   AZURE_RESOURCE_GROUP     resource group name (default: insurance-saas-staging-rg)
#   POSTGRES_ADMIN_PASSWORD  required only when staging.parameters.json
#                            has deployPostgres=true
#
# Owed-by-human pre-reqs (one-time):
#   - Subscription with Contributor role
#   - Resource group created (`az group create -l southeastasia -n <rg>`)
#   - `az login` completed (or service principal env vars set)
# =============================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENVIRONMENT="${ENVIRONMENT:-staging}"
LOCATION="${LOCATION:-southeastasia}"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-insurance-saas-${ENVIRONMENT}-rg}"
PARAM_FILE="infra/bicep/${ENVIRONMENT}.parameters.json"
TEMPLATE_FILE="infra/bicep/main.bicep"

log() { printf '[deploy:%s] %s\n' "${ENVIRONMENT}" "$*"; }
err() { printf '[deploy:%s] ERROR: %s\n' "${ENVIRONMENT}" "$*" >&2; }

# ---- 0. Pre-req checks -------------------------------------------------------
for tool in az docker jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    err "$tool is not installed."
    exit 1
  fi
done
if [ ! -f "$TEMPLATE_FILE" ]; then
  err "Bicep template missing: $TEMPLATE_FILE"
  exit 1
fi
if [ ! -f "$PARAM_FILE" ]; then
  err "Parameter file missing: $PARAM_FILE"
  exit 1
fi

# Postgres password is only required when the parameters file enables Postgres.
DEPLOY_POSTGRES="$(jq -r '.parameters.deployPostgres.value // false' "$PARAM_FILE")"
if [ "$DEPLOY_POSTGRES" = "true" ] && [ -z "${POSTGRES_ADMIN_PASSWORD:-}" ]; then
  err "deployPostgres=true in $PARAM_FILE but POSTGRES_ADMIN_PASSWORD is not set."
  exit 1
fi

# ---- 1. Azure auth -----------------------------------------------------------
if ! az account show >/dev/null 2>&1; then
  err "Not logged into Azure. Run 'az login' first."
  exit 1
fi
if [ -n "${AZURE_SUBSCRIPTION_ID:-}" ]; then
  log "Selecting subscription ${AZURE_SUBSCRIPTION_ID}"
  az account set --subscription "$AZURE_SUBSCRIPTION_ID"
fi

# ---- 2. Ensure resource group ------------------------------------------------
if ! az group show --name "$RESOURCE_GROUP" >/dev/null 2>&1; then
  log "Resource group $RESOURCE_GROUP not found — creating in $LOCATION"
  az group create --name "$RESOURCE_GROUP" --location "$LOCATION" >/dev/null
fi

# ---- 3. Build + push container image ----------------------------------------
GIT_SHA="$(git rev-parse --short HEAD)"
IMAGE_TAG="$GIT_SHA"

# Determine ACR login server. On the very first deploy the registry doesn't
# exist yet, so we deploy infrastructure first with a placeholder image, then
# build + push, then redeploy with the real tag.
ACR_NAME="$(az acr list --resource-group "$RESOURCE_GROUP" --query '[0].name' -o tsv 2>/dev/null || true)"

# Common base parameters passed on every az deployment call.
BASE_PARAMS=(
  --resource-group "$RESOURCE_GROUP"
  --template-file "$TEMPLATE_FILE"
  --parameters "@${PARAM_FILE}"
)
if [ "$DEPLOY_POSTGRES" = "true" ]; then
  BASE_PARAMS+=(--parameters "postgresAdminPassword=$POSTGRES_ADMIN_PASSWORD")
fi

if [ -z "$ACR_NAME" ]; then
  log "ACR not yet provisioned — bootstrapping infra with placeholder image"
  PLACEHOLDER_IMAGE='mcr.microsoft.com/azuredocs/aci-helloworld:latest'

  az deployment group create \
    "${BASE_PARAMS[@]}" \
    --parameters appImage="$PLACEHOLDER_IMAGE" \
    --output none

  ACR_NAME="$(az acr list --resource-group "$RESOURCE_GROUP" --query '[0].name' -o tsv)"
fi

ACR_LOGIN_SERVER="$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)"
IMAGE_REF="${ACR_LOGIN_SERVER}/insurance-saas-web:${IMAGE_TAG}"

log "Logging into ACR $ACR_NAME"
az acr login --name "$ACR_NAME"

log "Building container image $IMAGE_REF"
docker build -t "$IMAGE_REF" -f Dockerfile .

log "Pushing image"
docker push "$IMAGE_REF"

# ---- 4. Deploy with the real image tag --------------------------------------
log "Deploying $TEMPLATE_FILE with image tag $IMAGE_TAG"
DEPLOYMENT_NAME="${ENVIRONMENT}-$(date -u +%Y%m%d-%H%M%S)"

az deployment group create \
  --name "$DEPLOYMENT_NAME" \
  "${BASE_PARAMS[@]}" \
  --parameters appImage="$IMAGE_REF" \
  --output none

# ---- 5. Surface outputs ------------------------------------------------------
APP_URL="$(az deployment group show \
  --name "$DEPLOYMENT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query 'properties.outputs.appUrl.value' -o tsv)"

log "Deploy complete."
log "App URL: $APP_URL"
