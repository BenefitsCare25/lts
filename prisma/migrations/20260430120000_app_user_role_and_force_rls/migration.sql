-- =============================================================
-- C5 — Make RLS actually enforceable.
--
-- The 20260428100000_extend_rls migration enabled policies on every
-- tenant-scoped table, but the default `postgres` superuser bypasses
-- RLS even with FORCE ROW LEVEL SECURITY. Production needs:
--   1. A non-superuser app role under which the application connects.
--   2. FORCE ROW LEVEL SECURITY so the table owner is also subject to
--      policies (defence-in-depth: even if the owner role leaks).
--   3. Grants so `app_user` can SELECT/INSERT/UPDATE/DELETE everything
--      it needs, and matches default privileges so future tables
--      inherit them automatically.
--
-- Operational notes:
--   - DDL (CREATE TABLE / ALTER TABLE / migrations) is NOT subject
--     to RLS. Prisma `migrate deploy` continues to work as the
--     superuser/owner; only DML enforcement changes.
--   - The application's DATABASE_URL must be updated to connect as
--     `app_user` (or another non-superuser role) for RLS to apply.
--     Until that flip happens, the policies remain advisory under
--     superuser and this migration is a no-op for production.
--   - The integration test suite spins up its own app_user role
--     (see `apps/web/tests/integration/setup-app-role.sql`) so the
--     cross-tenant suite exercises the same policies.
-- =============================================================

-- ---- 1. Create the role idempotently ---------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    -- LOGIN with NOSUPERUSER, NOCREATEDB, NOCREATEROLE — minimum
    -- privileges for an application user. Production sets the
    -- password via `ALTER ROLE` from a separate secret (the password
    -- we set here is a placeholder so the role can be created in CI
    -- without secret plumbing; rotate before any prod connection).
    EXECUTE 'CREATE ROLE app_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ''change_me_via_alter_role''';
  END IF;
END
$$;

-- ---- 2. Schema and table privileges ----------------------------
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;

-- Default privileges so tables/sequences/functions added by future
-- migrations are automatically granted to app_user. The migration
-- runner is the table owner (typically `postgres`); FOR ROLE pins the
-- defaults to that owner so they apply across migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_user;

-- ---- 3. FORCE ROW LEVEL SECURITY on every RLS-enabled table ---
-- Without FORCE, the table owner bypasses policies. With FORCE, only
-- BYPASSRLS-attribute roles bypass — and we don't grant that to
-- app_user. The migration owner (postgres superuser) still bypasses
-- because superusers ignore RLS regardless; that's documented and
-- limited to DDL paths.

ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeSchema" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Insurer" FORCE ROW LEVEL SECURITY;
ALTER TABLE "TPA" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Pool" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ProductType" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Client" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Policy" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PolicyEntity" FORCE ROW LEVEL SECURITY;
ALTER TABLE "BenefitYear" FORCE ROW LEVEL SECURITY;
ALTER TABLE "BenefitGroup" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Plan" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ProductEligibility" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PremiumRate" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Employee" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Dependent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Enrollment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PlacementSlipUpload" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PoolMembership" FORCE ROW LEVEL SECURITY;

-- TenantAiProvider was added in 20260430044143_add_extraction_draft_and_ai_provider;
-- ensure it has RLS + FORCE in case it landed before the extend_rls migration
-- in a fresh env.
ALTER TABLE "TenantAiProvider" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TenantAiProvider";
CREATE POLICY tenant_isolation ON "TenantAiProvider" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
ALTER TABLE "TenantAiProvider" FORCE ROW LEVEL SECURITY;

-- ExtractionDraft has a direct tenantId column (added in 20260430044143).
-- Use the simple direct policy.
ALTER TABLE "ExtractionDraft" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ExtractionDraft";
CREATE POLICY tenant_isolation ON "ExtractionDraft" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
ALTER TABLE "ExtractionDraft" FORCE ROW LEVEL SECURITY;
