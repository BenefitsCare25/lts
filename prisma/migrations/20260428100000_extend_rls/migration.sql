-- =============================================================
-- Phase 2A item 1 — Extend Row-Level Security to all tenant-scoped
-- tables, including those that carry tenantId only via a parent FK.
--
-- Phase 1 (S3) applied RLS to the 8 directly-scoped tables (User,
-- EmployeeSchema, Insurer, TPA, Pool, ProductType, Client, AuditLog)
-- via scripts/setup-rls.sql. This migration:
--   1. Re-applies those 8 policies idempotently so the migration
--      history is the single source of truth (the script remains
--      as a manual recovery tool).
--   2. Adds policies to the 13 indirect tables (Policy, PolicyEntity,
--      BenefitYear, BenefitGroup, Product, Plan, ProductEligibility,
--      PremiumRate, Employee, Dependent, Enrollment, PlacementSlipUpload,
--      PoolMembership) so a forgotten join in app code can no longer
--      leak across tenants.
--
-- Helper functions resolve a row's tenant by walking parent FKs.
-- They're STABLE so the optimizer can fold them into the row scan
-- and use the primary-key index — no full-table scan per row.
--
-- Dev / CI note. The default `postgres` superuser bypasses RLS even
-- with FORCE ROW LEVEL SECURITY. Production runs under a non-
-- superuser app role where the policies actually apply. CI-level
-- enforcement of RLS is a follow-up (introduce an `app_user` role
-- in setup and run integration tests as that role).
-- =============================================================

-- ---- Helper functions -----------------------------------------
-- One per parent path. Marked STABLE because the result depends on
-- table contents (not "IMMUTABLE") but doesn't change inside a single
-- statement. STRICT skips evaluation if input is NULL — required for
-- correctness when an FK is nullable (none of these are, but defensive).

CREATE OR REPLACE FUNCTION app_tenant_of_client(client_id text)
RETURNS text
LANGUAGE sql STABLE STRICT
AS $$
  SELECT "tenantId" FROM "Client" WHERE "id" = client_id
$$;

CREATE OR REPLACE FUNCTION app_tenant_of_policy(policy_id text)
RETURNS text
LANGUAGE sql STABLE STRICT
AS $$
  SELECT app_tenant_of_client("clientId") FROM "Policy" WHERE "id" = policy_id
$$;

CREATE OR REPLACE FUNCTION app_tenant_of_benefit_year(benefit_year_id text)
RETURNS text
LANGUAGE sql STABLE STRICT
AS $$
  SELECT app_tenant_of_policy("policyId") FROM "BenefitYear" WHERE "id" = benefit_year_id
$$;

CREATE OR REPLACE FUNCTION app_tenant_of_product(product_id text)
RETURNS text
LANGUAGE sql STABLE STRICT
AS $$
  SELECT app_tenant_of_benefit_year("benefitYearId") FROM "Product" WHERE "id" = product_id
$$;

CREATE OR REPLACE FUNCTION app_tenant_of_employee(employee_id text)
RETURNS text
LANGUAGE sql STABLE STRICT
AS $$
  SELECT app_tenant_of_client("clientId") FROM "Employee" WHERE "id" = employee_id
$$;

CREATE OR REPLACE FUNCTION app_tenant_of_pool(pool_id text)
RETURNS text
LANGUAGE sql STABLE STRICT
AS $$
  SELECT "tenantId" FROM "Pool" WHERE "id" = pool_id
$$;

-- ---- Direct tenantId tables (idempotent re-apply) -------------
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY is idempotent.
-- DROP POLICY IF EXISTS ... CREATE POLICY makes the policy
-- definition itself idempotent.

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "User";
CREATE POLICY tenant_isolation ON "User" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

ALTER TABLE "EmployeeSchema" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "EmployeeSchema";
CREATE POLICY tenant_isolation ON "EmployeeSchema" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

ALTER TABLE "Insurer" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Insurer";
CREATE POLICY tenant_isolation ON "Insurer" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

ALTER TABLE "TPA" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TPA";
CREATE POLICY tenant_isolation ON "TPA" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

ALTER TABLE "Pool" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Pool";
CREATE POLICY tenant_isolation ON "Pool" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

ALTER TABLE "ProductType" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ProductType";
CREATE POLICY tenant_isolation ON "ProductType" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

ALTER TABLE "Client" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Client";
CREATE POLICY tenant_isolation ON "Client" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AuditLog";
CREATE POLICY tenant_isolation ON "AuditLog" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

-- ---- Indirect tables (parent FK → tenantId) -------------------

ALTER TABLE "Policy" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Policy";
CREATE POLICY tenant_isolation ON "Policy" FOR ALL
  USING (app_tenant_of_client("clientId") = current_setting('app.current_tenant_id', true))
  WITH CHECK (app_tenant_of_client("clientId") = current_setting('app.current_tenant_id', true));

ALTER TABLE "PolicyEntity" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PolicyEntity";
CREATE POLICY tenant_isolation ON "PolicyEntity" FOR ALL
  USING (app_tenant_of_policy("policyId") = current_setting('app.current_tenant_id', true))
  WITH CHECK (app_tenant_of_policy("policyId") = current_setting('app.current_tenant_id', true));

ALTER TABLE "BenefitYear" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BenefitYear";
CREATE POLICY tenant_isolation ON "BenefitYear" FOR ALL
  USING (app_tenant_of_policy("policyId") = current_setting('app.current_tenant_id', true))
  WITH CHECK (app_tenant_of_policy("policyId") = current_setting('app.current_tenant_id', true));

ALTER TABLE "BenefitGroup" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BenefitGroup";
CREATE POLICY tenant_isolation ON "BenefitGroup" FOR ALL
  USING (app_tenant_of_policy("policyId") = current_setting('app.current_tenant_id', true))
  WITH CHECK (app_tenant_of_policy("policyId") = current_setting('app.current_tenant_id', true));

ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Product";
CREATE POLICY tenant_isolation ON "Product" FOR ALL
  USING (app_tenant_of_benefit_year("benefitYearId") = current_setting('app.current_tenant_id', true))
  WITH CHECK (app_tenant_of_benefit_year("benefitYearId") = current_setting('app.current_tenant_id', true));

ALTER TABLE "Plan" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Plan";
CREATE POLICY tenant_isolation ON "Plan" FOR ALL
  USING (app_tenant_of_product("productId") = current_setting('app.current_tenant_id', true))
  WITH CHECK (app_tenant_of_product("productId") = current_setting('app.current_tenant_id', true));

ALTER TABLE "ProductEligibility" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ProductEligibility";
CREATE POLICY tenant_isolation ON "ProductEligibility" FOR ALL
  USING (app_tenant_of_product("productId") = current_setting('app.current_tenant_id', true))
  WITH CHECK (app_tenant_of_product("productId") = current_setting('app.current_tenant_id', true));

ALTER TABLE "PremiumRate" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PremiumRate";
CREATE POLICY tenant_isolation ON "PremiumRate" FOR ALL
  USING (app_tenant_of_product("productId") = current_setting('app.current_tenant_id', true))
  WITH CHECK (app_tenant_of_product("productId") = current_setting('app.current_tenant_id', true));

ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Employee";
CREATE POLICY tenant_isolation ON "Employee" FOR ALL
  USING (app_tenant_of_client("clientId") = current_setting('app.current_tenant_id', true))
  WITH CHECK (app_tenant_of_client("clientId") = current_setting('app.current_tenant_id', true));

ALTER TABLE "Dependent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Dependent";
CREATE POLICY tenant_isolation ON "Dependent" FOR ALL
  USING (app_tenant_of_employee("employeeId") = current_setting('app.current_tenant_id', true))
  WITH CHECK (app_tenant_of_employee("employeeId") = current_setting('app.current_tenant_id', true));

ALTER TABLE "Enrollment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Enrollment";
CREATE POLICY tenant_isolation ON "Enrollment" FOR ALL
  USING (app_tenant_of_employee("employeeId") = current_setting('app.current_tenant_id', true))
  WITH CHECK (app_tenant_of_employee("employeeId") = current_setting('app.current_tenant_id', true));

ALTER TABLE "PlacementSlipUpload" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PlacementSlipUpload";
CREATE POLICY tenant_isolation ON "PlacementSlipUpload" FOR ALL
  USING (app_tenant_of_client("clientId") = current_setting('app.current_tenant_id', true))
  WITH CHECK (app_tenant_of_client("clientId") = current_setting('app.current_tenant_id', true));

ALTER TABLE "PoolMembership" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PoolMembership";
CREATE POLICY tenant_isolation ON "PoolMembership" FOR ALL
  USING (app_tenant_of_pool("poolId") = current_setting('app.current_tenant_id', true))
  WITH CHECK (app_tenant_of_pool("poolId") = current_setting('app.current_tenant_id', true));
