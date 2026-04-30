-- CreateTable
CREATE TABLE "TenantAiProvider" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'azure_ai_foundry',
    "endpoint" TEXT NOT NULL,
    "deploymentName" TEXT NOT NULL,
    "apiVersion" TEXT NOT NULL DEFAULT '2024-08-01-preview',
    "encryptedKey" TEXT NOT NULL,
    "keyLastFour" VARCHAR(4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantAiProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionDraft" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" JSONB NOT NULL,
    "extractedProducts" JSONB NOT NULL,
    "validationIssues" JSONB,
    "appliedAt" TIMESTAMP(3),
    "appliedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractionDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantAiProvider_tenantId_key" ON "TenantAiProvider"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionDraft_uploadId_key" ON "ExtractionDraft"("uploadId");

-- CreateIndex
CREATE INDEX "ExtractionDraft_tenantId_status_idx" ON "ExtractionDraft"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "TenantAiProvider" ADD CONSTRAINT "TenantAiProvider_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionDraft" ADD CONSTRAINT "ExtractionDraft_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionDraft" ADD CONSTRAINT "ExtractionDraft_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "PlacementSlipUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================
-- Row-Level Security — extend the existing tenant_isolation
-- pattern (see 20260428100000_extend_rls) to the two new tables.
-- Both carry tenantId directly, so the policy is the same simple
-- equality check used on every other directly-scoped table.
-- =============================================================

ALTER TABLE "TenantAiProvider" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TenantAiProvider";
CREATE POLICY tenant_isolation ON "TenantAiProvider" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

ALTER TABLE "ExtractionDraft" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ExtractionDraft";
CREATE POLICY tenant_isolation ON "ExtractionDraft" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
