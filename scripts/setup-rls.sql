-- =============================================================
-- ⚠️ SUPERSEDED by migration 20260428100000_extend_rls — do not run.
--
-- Phase 1 (S3) shipped this script as an out-of-band step. Phase 2A
-- folds RLS into the migration history, so `prisma migrate deploy`
-- now applies (and re-applies idempotently) all RLS policies plus
-- the new policies on the 13 indirect tables.
--
-- This file is retained for forensic reference only — it shows the
-- Phase 1 baseline (8 directly-scoped tables). The migration is the
-- canonical source for current policy definitions.
--
-- Recovery procedure (if a target DB lacks RLS for any reason):
--   pnpm prisma migrate resolve --applied 20260428100000_extend_rls
--   pnpm prisma migrate deploy
-- =============================================================

-- ---- Enable RLS on tenant-scoped tables ----------------------

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeSchema" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Insurer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TPA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Pool" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Client" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;

-- ---- Policies: tenant_id must match the session variable ------
-- current_setting('app.current_tenant_id', true) returns NULL
-- (not an error) when the variable is unset, which causes the
-- policy to evaluate false and return no rows — safe default.

DROP POLICY IF EXISTS tenant_isolation ON "User";
CREATE POLICY tenant_isolation ON "User"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON "EmployeeSchema";
CREATE POLICY tenant_isolation ON "EmployeeSchema"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON "Insurer";
CREATE POLICY tenant_isolation ON "Insurer"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON "TPA";
CREATE POLICY tenant_isolation ON "TPA"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON "Pool";
CREATE POLICY tenant_isolation ON "Pool"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON "ProductType";
CREATE POLICY tenant_isolation ON "ProductType"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON "Client";
CREATE POLICY tenant_isolation ON "Client"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON "AuditLog";
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));
