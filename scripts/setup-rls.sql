-- =============================================================
-- Postgres Row-Level Security setup for Phase 1.
--
-- Run AFTER prisma migrate deploy, against the target database:
--   psql "$DATABASE_URL" -f scripts/setup-rls.sql
--
-- Applied to the 8 directly tenant-scoped tables. Models accessed
-- only via relations (Policy, Employee, etc.) are isolated at the
-- application layer by navigating through their tenant-scoped parent.
--
-- The application sets app.current_tenant_id per request via:
--   SELECT set_config('app.current_tenant_id', '<id>', false)
--
-- Note: saas_admin has azure_pg_admin which bypasses RLS — this is
-- intentional so migrations and seeds run without interference.
-- Phase 2 introduces a separate app_user role without BYPASSRLS.
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
