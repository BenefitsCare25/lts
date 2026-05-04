-- =============================================================
-- Employee Portal foundation — data model additions.
--
-- 1. Employee.userId FK (optional, unique) — links a portal User
--    to their Employee record.
-- 2. DependentChangeRequest — broker-approved dependent lifecycle
--    changes initiated by employees via the portal.
-- 3. EmployeeInvitation — secure token for portal onboarding flow.
--
-- RLS policies added for the two new tenant-scoped tables.
-- =============================================================

-- ---- 1. Employee.userId FK --------------------------------------

ALTER TABLE "Employee" ADD COLUMN "userId" TEXT;

-- Unique constraint (1:1 — each User maps to at most one Employee).
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_key" UNIQUE ("userId");

-- Foreign key to User.
ALTER TABLE "Employee"
  ADD CONSTRAINT "Employee_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---- 2. DependentChangeRequest ----------------------------------

CREATE TABLE "DependentChangeRequest" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "employeeId"      TEXT NOT NULL,
  "action"          TEXT NOT NULL,
  "dependentId"     TEXT,
  "data"            JSONB NOT NULL,
  "relation"        TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "reviewedBy"      TEXT,
  "reviewedAt"      TIMESTAMP(3),
  "rejectionReason" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DependentChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DependentChangeRequest_tenantId_status_idx"
  ON "DependentChangeRequest"("tenantId", "status");

CREATE INDEX "DependentChangeRequest_employeeId_idx"
  ON "DependentChangeRequest"("employeeId");

ALTER TABLE "DependentChangeRequest"
  ADD CONSTRAINT "DependentChangeRequest_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- 3. EmployeeInvitation --------------------------------------

CREATE TABLE "EmployeeInvitation" (
  "id"         TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "email"      TEXT NOT NULL,
  "token"      TEXT NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmployeeInvitation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EmployeeInvitation"
  ADD CONSTRAINT "EmployeeInvitation_token_key" UNIQUE ("token");

CREATE INDEX "EmployeeInvitation_tenantId_idx"
  ON "EmployeeInvitation"("tenantId");

CREATE INDEX "EmployeeInvitation_employeeId_idx"
  ON "EmployeeInvitation"("employeeId");

ALTER TABLE "EmployeeInvitation"
  ADD CONSTRAINT "EmployeeInvitation_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- 4. RLS policies for new tables -----------------------------

ALTER TABLE "DependentChangeRequest" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DependentChangeRequest";
CREATE POLICY tenant_isolation ON "DependentChangeRequest" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

ALTER TABLE "EmployeeInvitation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "EmployeeInvitation";
CREATE POLICY tenant_isolation ON "EmployeeInvitation" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

-- Grant app_user access to the new tables (matches 20260430120000
-- pattern where app_user gets full DML on tenant-scoped tables).
GRANT SELECT, INSERT, UPDATE, DELETE ON "DependentChangeRequest" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "EmployeeInvitation" TO app_user;
