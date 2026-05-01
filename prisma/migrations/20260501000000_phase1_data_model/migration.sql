-- =============================================================
-- Phase 1 — Data model redesign
-- See claudedocs/production-readiness/02-data-model.md for rationale.
--
-- Changes:
--   1. Plan: add PlanStack join table for multi-parent stacking
--            (deprecates single-FK Plan.stacksOn)
--   2. PremiumRate: add basis enum column + rate shape columns
--            (per_unit_earnings, per_employee, flat) + CHECK constraint
--   3. ExtractionAttempt: per-AI-call cost history (new table + RLS)
--   4. AppliedDraftSnapshot: immutable apply-time audit record (new table + RLS)
--
-- Rollback SQL is in rollback.sql alongside this file.
-- =============================================================

-- ── 1. PlanStack — multi-parent stacking join table ───────────

CREATE TABLE "PlanStack" (
  "childId"  TEXT NOT NULL,
  "parentId" TEXT NOT NULL,
  CONSTRAINT "PlanStack_pkey" PRIMARY KEY ("childId", "parentId"),
  CONSTRAINT "PlanStack_child_fkey"  FOREIGN KEY ("childId")  REFERENCES "Plan"("id") ON DELETE CASCADE,
  CONSTRAINT "PlanStack_parent_fkey" FOREIGN KEY ("parentId") REFERENCES "Plan"("id") ON DELETE RESTRICT
);

CREATE INDEX "PlanStack_parentId_idx" ON "PlanStack"("parentId");

-- Backfill: lift existing single-parent stacks into the join table.
-- Plan.stacksOn holds a Plan.id string (not a rawCode); direct insert.
INSERT INTO "PlanStack" ("childId", "parentId")
SELECT "id", "stacksOn"
FROM "Plan"
WHERE "stacksOn" IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── 2. PremiumRate — basis enum + additional rate columns ─────

ALTER TABLE "PremiumRate"
  ADD COLUMN "basis" TEXT NOT NULL DEFAULT 'per_thousand_si';

ALTER TABLE "PremiumRate"
  ADD COLUMN "ratePerEarningsUnit"     DECIMAL(14, 8);

ALTER TABLE "PremiumRate"
  ADD COLUMN "estimatedAnnualEarnings" DECIMAL(14, 2);

ALTER TABLE "PremiumRate"
  ADD COLUMN "ratePerEmployee"         DECIMAL(12, 4);

CREATE INDEX "PremiumRate_productId_basis_idx" ON "PremiumRate"("productId", "basis");

-- CHECK constraint: exactly one rate column is non-null per basis value.
-- Defence-in-depth — the Ajv guard on extraction and the tRPC input
-- validators are the first two lines; this is the third.
ALTER TABLE "PremiumRate" ADD CONSTRAINT "PremiumRate_basis_consistency" CHECK (
  (
    "basis" = 'per_thousand_si'
    AND "ratePerThousand"    IS NOT NULL
    AND "fixedAmount"        IS NULL
    AND "ratePerEarningsUnit" IS NULL
    AND "ratePerEmployee"    IS NULL
  ) OR (
    "basis" = 'per_unit_earnings'
    AND "ratePerEarningsUnit" IS NOT NULL
    AND "ratePerThousand"    IS NULL
    AND "fixedAmount"        IS NULL
    AND "ratePerEmployee"    IS NULL
  ) OR (
    "basis" = 'per_employee'
    AND "ratePerEmployee"    IS NOT NULL
    AND "ratePerThousand"    IS NULL
    AND "fixedAmount"        IS NULL
    AND "ratePerEarningsUnit" IS NULL
  ) OR (
    "basis" = 'flat'
    AND "fixedAmount"        IS NOT NULL
    AND "ratePerThousand"    IS NULL
    AND "ratePerEarningsUnit" IS NULL
    AND "ratePerEmployee"    IS NULL
  )
);

-- ── 3. ExtractionAttempt — per-AI-call cost history ───────────

CREATE TABLE "ExtractionAttempt" (
  "id"                  TEXT        NOT NULL,
  "tenantId"            TEXT        NOT NULL,
  "draftId"             TEXT        NOT NULL,
  "attemptNumber"       INTEGER     NOT NULL,
  "stage"               TEXT        NOT NULL,
  "productKey"          TEXT,
  "status"              TEXT        NOT NULL,
  "model"               TEXT,
  "inputTokens"         INTEGER,
  "outputTokens"        INTEGER,
  "cacheReadTokens"     INTEGER,
  "cacheCreationTokens" INTEGER,
  "latencyMs"           INTEGER,
  "rawResponse"         JSONB,
  "error"               TEXT,
  "startedAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completedAt"         TIMESTAMPTZ,
  CONSTRAINT "ExtractionAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExtractionAttempt_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ExtractionAttempt_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES "ExtractionDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ExtractionAttempt_tenantId_draftId_idx"  ON "ExtractionAttempt"("tenantId", "draftId");
CREATE INDEX "ExtractionAttempt_tenantId_productKey_idx" ON "ExtractionAttempt"("tenantId", "productKey");
CREATE INDEX "ExtractionAttempt_tenantId_startedAt_idx" ON "ExtractionAttempt"("tenantId", "startedAt");

ALTER TABLE "ExtractionAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExtractionAttempt" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ExtractionAttempt";
CREATE POLICY tenant_isolation ON "ExtractionAttempt" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "ExtractionAttempt" TO app_user;

-- ── 4. AppliedDraftSnapshot — immutable apply-time audit ──────

CREATE TABLE "AppliedDraftSnapshot" (
  "id"             TEXT        NOT NULL,
  "tenantId"       TEXT        NOT NULL,
  "draftId"        TEXT        NOT NULL,
  "uploadId"       TEXT        NOT NULL,
  "appliedAt"      TIMESTAMPTZ NOT NULL,
  "appliedById"    TEXT        NOT NULL,
  "draftState"     JSONB       NOT NULL,
  "cataloguedRows" JSONB       NOT NULL,
  "draftStateHash" TEXT        NOT NULL,
  CONSTRAINT "AppliedDraftSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppliedDraftSnapshot_draftId_key" UNIQUE ("draftId"),
  CONSTRAINT "AppliedDraftSnapshot_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AppliedDraftSnapshot_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES "ExtractionDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AppliedDraftSnapshot_tenantId_uploadId_idx" ON "AppliedDraftSnapshot"("tenantId", "uploadId");
CREATE INDEX "AppliedDraftSnapshot_tenantId_appliedAt_idx" ON "AppliedDraftSnapshot"("tenantId", "appliedAt");

ALTER TABLE "AppliedDraftSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppliedDraftSnapshot" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AppliedDraftSnapshot";
CREATE POLICY tenant_isolation ON "AppliedDraftSnapshot" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "AppliedDraftSnapshot" TO app_user;
