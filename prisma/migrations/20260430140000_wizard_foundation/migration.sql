-- =============================================================
-- Wizard foundation — DB scaffold for the import-first Create Client
-- wizard. See docs/PHASE_1_BUILD_PLAN_v2.md and CLAUDE.md for context.
--
-- This migration:
--   1. Adds tenantId directly to PlacementSlipUpload and makes
--      clientId nullable. Orphan uploads (no client yet) are how the
--      wizard works on /admin/clients/new before the user has even
--      decided what client they're creating.
--   2. Adds Policy.ageBasis (POLICY_START | HIRE_DATE | AS_AT_EVENT)
--      so the predicate engine can compute employee age consistently
--      with the policy contract.
--   3. Adds BenefitYear.carryForwardFromYearId for renewal carry-
--      forward of Enrollment + ProductEligibility selections.
--   4. Creates tenant-scoped registries:
--        BenefitGroupPreset, EndorsementCatalogue, ExclusionCatalogue
--   5. Creates policy / product-scoped extensions:
--        PolicyException, FlexBundle + FlexBundlePlan, ProductAttachment
--   6. Creates the system-level IssueType registry (no tenantId).
--   7. Wires RLS policies for every new tenant-scoped table, plus the
--      replacement direct-tenantId policy on PlacementSlipUpload.
-- =============================================================

-- ── 1. PlacementSlipUpload becomes orphan-capable ─────────────
-- Add tenantId, back-fill from existing client mappings, then make
-- clientId nullable. The default '' on tenantId is a transient hack
-- so the column can be added without violating NOT NULL during the
-- back-fill — it's overwritten before the constraint is set strict.

ALTER TABLE "PlacementSlipUpload"
  ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';

UPDATE "PlacementSlipUpload" psu
SET "tenantId" = c."tenantId"
FROM "Client" c
WHERE psu."clientId" = c."id";

-- Drop the placeholder default; future inserts must supply tenantId.
ALTER TABLE "PlacementSlipUpload"
  ALTER COLUMN "tenantId" DROP DEFAULT;

-- Allow orphan uploads (clientId NULL until wizard Apply binds it).
ALTER TABLE "PlacementSlipUpload"
  ALTER COLUMN "clientId" DROP NOT NULL;

CREATE INDEX "PlacementSlipUpload_tenantId_idx"
  ON "PlacementSlipUpload"("tenantId");

ALTER TABLE "PlacementSlipUpload"
  ADD CONSTRAINT "PlacementSlipUpload_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Replace the parent-FK RLS with a direct tenantId check that works
-- even when clientId is NULL (orphan rows). See 20260428100000_extend_rls
-- for the original parent-FK helper pattern.
DROP POLICY IF EXISTS tenant_isolation ON "PlacementSlipUpload";
CREATE POLICY tenant_isolation ON "PlacementSlipUpload" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
-- FORCE was already set in 20260430120000; re-asserting is idempotent.
ALTER TABLE "PlacementSlipUpload" FORCE ROW LEVEL SECURITY;

-- ── 2. Policy.ageBasis ────────────────────────────────────────
CREATE TYPE "AgeBasis" AS ENUM ('POLICY_START', 'HIRE_DATE', 'AS_AT_EVENT');

ALTER TABLE "Policy"
  ADD COLUMN "ageBasis" "AgeBasis" NOT NULL DEFAULT 'POLICY_START';

-- ── 3. BenefitYear.carryForwardFromYearId ─────────────────────
ALTER TABLE "BenefitYear"
  ADD COLUMN "carryForwardFromYearId" TEXT;

ALTER TABLE "BenefitYear"
  ADD CONSTRAINT "BenefitYear_carryForwardFromYearId_fkey"
  FOREIGN KEY ("carryForwardFromYearId") REFERENCES "BenefitYear"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX "BenefitYear_carryForwardFromYearId_idx"
  ON "BenefitYear"("carryForwardFromYearId");

-- ── 4a. BenefitGroupPreset (tenant-scoped) ────────────────────
CREATE TABLE "BenefitGroupPreset" (
  "id"                     TEXT NOT NULL,
  "tenantId"               TEXT NOT NULL,
  "name"                   TEXT NOT NULL,
  "description"            TEXT,
  "predicate"              JSONB NOT NULL,
  "category"               TEXT,
  "applicableProductCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BenefitGroupPreset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BenefitGroupPreset_tenantId_name_key"
  ON "BenefitGroupPreset"("tenantId", "name");
CREATE INDEX "BenefitGroupPreset_tenantId_idx"
  ON "BenefitGroupPreset"("tenantId");

ALTER TABLE "BenefitGroupPreset"
  ADD CONSTRAINT "BenefitGroupPreset_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BenefitGroupPreset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BenefitGroupPreset" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BenefitGroupPreset";
CREATE POLICY tenant_isolation ON "BenefitGroupPreset" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

-- ── 4b. EndorsementCatalogue (tenant-scoped) ──────────────────
CREATE TABLE "EndorsementCatalogue" (
  "id"                     TEXT NOT NULL,
  "tenantId"               TEXT NOT NULL,
  "code"                   TEXT NOT NULL,
  "label"                  TEXT NOT NULL,
  "description"            TEXT,
  "applicableProductCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active"                 BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "EndorsementCatalogue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EndorsementCatalogue_tenantId_code_key"
  ON "EndorsementCatalogue"("tenantId", "code");
CREATE INDEX "EndorsementCatalogue_tenantId_idx"
  ON "EndorsementCatalogue"("tenantId");

ALTER TABLE "EndorsementCatalogue"
  ADD CONSTRAINT "EndorsementCatalogue_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EndorsementCatalogue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EndorsementCatalogue" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "EndorsementCatalogue";
CREATE POLICY tenant_isolation ON "EndorsementCatalogue" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

-- ── 4c. ExclusionCatalogue (tenant-scoped, mirror) ────────────
CREATE TABLE "ExclusionCatalogue" (
  "id"                     TEXT NOT NULL,
  "tenantId"               TEXT NOT NULL,
  "code"                   TEXT NOT NULL,
  "label"                  TEXT NOT NULL,
  "description"            TEXT,
  "applicableProductCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active"                 BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "ExclusionCatalogue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExclusionCatalogue_tenantId_code_key"
  ON "ExclusionCatalogue"("tenantId", "code");
CREATE INDEX "ExclusionCatalogue_tenantId_idx"
  ON "ExclusionCatalogue"("tenantId");

ALTER TABLE "ExclusionCatalogue"
  ADD CONSTRAINT "ExclusionCatalogue_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExclusionCatalogue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExclusionCatalogue" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ExclusionCatalogue";
CREATE POLICY tenant_isolation ON "ExclusionCatalogue" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

-- ── 5a. PolicyException (policy-scoped via parent FK) ─────────
CREATE TABLE "PolicyException" (
  "id"            TEXT NOT NULL,
  "policyId"      TEXT NOT NULL,
  "productId"     TEXT,
  "planId"        TEXT,
  "employeeId"    TEXT NOT NULL,
  "exceptionType" TEXT NOT NULL,
  "reason"        TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PolicyException_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PolicyException_policyId_idx" ON "PolicyException"("policyId");
CREATE INDEX "PolicyException_employeeId_idx" ON "PolicyException"("employeeId");

ALTER TABLE "PolicyException"
  ADD CONSTRAINT "PolicyException_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "Policy"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PolicyException"
  ADD CONSTRAINT "PolicyException_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PolicyException"
  ADD CONSTRAINT "PolicyException_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PolicyException"
  ADD CONSTRAINT "PolicyException_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyException" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolicyException" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PolicyException";
CREATE POLICY tenant_isolation ON "PolicyException" FOR ALL
  USING (app_tenant_of_policy("policyId") = current_setting('app.current_tenant_id', true))
  WITH CHECK (app_tenant_of_policy("policyId") = current_setting('app.current_tenant_id', true));

-- ── 5b. FlexBundle + FlexBundlePlan (policy-scoped) ───────────
CREATE TABLE "FlexBundle" (
  "id"          TEXT NOT NULL,
  "policyId"    TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FlexBundle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FlexBundle_policyId_code_key"
  ON "FlexBundle"("policyId", "code");
CREATE INDEX "FlexBundle_policyId_idx" ON "FlexBundle"("policyId");

ALTER TABLE "FlexBundle"
  ADD CONSTRAINT "FlexBundle_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "Policy"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FlexBundle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FlexBundle" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FlexBundle";
CREATE POLICY tenant_isolation ON "FlexBundle" FOR ALL
  USING (app_tenant_of_policy("policyId") = current_setting('app.current_tenant_id', true))
  WITH CHECK (app_tenant_of_policy("policyId") = current_setting('app.current_tenant_id', true));

CREATE TABLE "FlexBundlePlan" (
  "id"        TEXT NOT NULL,
  "bundleId"  TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "planId"    TEXT NOT NULL,
  CONSTRAINT "FlexBundlePlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FlexBundlePlan_bundleId_productId_key"
  ON "FlexBundlePlan"("bundleId", "productId");
CREATE INDEX "FlexBundlePlan_bundleId_idx" ON "FlexBundlePlan"("bundleId");

ALTER TABLE "FlexBundlePlan"
  ADD CONSTRAINT "FlexBundlePlan_bundleId_fkey"
  FOREIGN KEY ("bundleId") REFERENCES "FlexBundle"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FlexBundlePlan"
  ADD CONSTRAINT "FlexBundlePlan_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FlexBundlePlan"
  ADD CONSTRAINT "FlexBundlePlan_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- New helper to walk FlexBundlePlan → FlexBundle → Policy → Client → tenantId.
CREATE OR REPLACE FUNCTION app_tenant_of_flex_bundle(bundle_id text)
RETURNS text
LANGUAGE sql STABLE STRICT
AS $$
  SELECT app_tenant_of_policy("policyId") FROM "FlexBundle" WHERE "id" = bundle_id
$$;

ALTER TABLE "FlexBundlePlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FlexBundlePlan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FlexBundlePlan";
CREATE POLICY tenant_isolation ON "FlexBundlePlan" FOR ALL
  USING (app_tenant_of_flex_bundle("bundleId") = current_setting('app.current_tenant_id', true))
  WITH CHECK (app_tenant_of_flex_bundle("bundleId") = current_setting('app.current_tenant_id', true));

-- ── 5c. ProductAttachment (product-scoped) ────────────────────
CREATE TABLE "ProductAttachment" (
  "id"            TEXT NOT NULL,
  "productId"     TEXT NOT NULL,
  "filename"      TEXT NOT NULL,
  "storageKey"    TEXT NOT NULL,
  "storageWebUrl" TEXT,
  "kind"          TEXT NOT NULL DEFAULT 'PRODUCT_SUMMARY',
  "uploadedBy"    TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductAttachment_productId_idx" ON "ProductAttachment"("productId");

ALTER TABLE "ProductAttachment"
  ADD CONSTRAINT "ProductAttachment_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductAttachment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ProductAttachment";
CREATE POLICY tenant_isolation ON "ProductAttachment" FOR ALL
  USING (app_tenant_of_product("productId") = current_setting('app.current_tenant_id', true))
  WITH CHECK (app_tenant_of_product("productId") = current_setting('app.current_tenant_id', true));

-- ── 6. IssueType (system-managed registry) ────────────────────
-- No tenantId — these are platform concepts, seeded once. The wizard's
-- generic <IssueResolver> reads `suggestedActions` to render action
-- buttons; handlers live in the application layer keyed by code.
CREATE TABLE "IssueType" (
  "code"             TEXT NOT NULL,
  "category"         TEXT NOT NULL,
  "defaultSeverity"  TEXT NOT NULL,
  "label"            TEXT NOT NULL,
  "description"      TEXT,
  "suggestedActions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  CONSTRAINT "IssueType_pkey" PRIMARY KEY ("code")
);

-- IssueType is read-mostly system data — no RLS. The ALTER DEFAULT
-- PRIVILEGES from 20260430120000 already grants SELECT to app_user
-- on future tables in `public`, so no explicit grant needed here.
