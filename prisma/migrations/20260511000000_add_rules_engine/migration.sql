-- Migration: add_rules_engine
-- Adds childMaxAge to Policy, rule engine tables, and updates Enrollment

-- Policy: child max age (per-policy override; default 21)
ALTER TABLE "Policy" ADD COLUMN "childMaxAge" INTEGER NOT NULL DEFAULT 21;

-- Enrollment: make benefitGroupId optional, add resolutionPath
ALTER TABLE "Enrollment" ALTER COLUMN "benefitGroupId" DROP NOT NULL;
ALTER TABLE "Enrollment" ADD COLUMN "resolutionPath" TEXT;

-- Employee → ProcessingError relation (index only; table created below)
-- (no-op here; handled by CREATE TABLE below)

-- ----------------------------------------------------------------
-- Rule engine tables (all scoped to BenefitYear via FK)
-- ----------------------------------------------------------------

CREATE TABLE "GradeNormalisationMap" (
  "id"            TEXT NOT NULL,
  "benefitYearId" TEXT NOT NULL,
  "gradeCode"     TEXT NOT NULL,
  "standardBand"  TEXT NOT NULL,
  CONSTRAINT "GradeNormalisationMap_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalaryBandRule" (
  "id"            TEXT NOT NULL,
  "benefitYearId" TEXT NOT NULL,
  "minSalary"     DECIMAL(14,2) NOT NULL,
  "maxSalary"     DECIMAL(14,2),
  "standardBand"  TEXT NOT NULL,
  CONSTRAINT "SalaryBandRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InsurancePlanRule" (
  "id"             TEXT NOT NULL,
  "benefitYearId"  TEXT NOT NULL,
  "standardBand"   TEXT NOT NULL,
  "employmentType" TEXT NOT NULL,
  "productId"      TEXT NOT NULL,
  "planId"         TEXT NOT NULL,
  "gmmBundled"     BOOLEAN NOT NULL DEFAULT false,
  "gbtEligible"    BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "InsurancePlanRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmploymentClassPlanOverride" (
  "id"                TEXT NOT NULL,
  "benefitYearId"     TEXT NOT NULL,
  "employmentClass"   TEXT NOT NULL,
  "employmentType"    TEXT NOT NULL,
  "productId"         TEXT NOT NULL,
  "planId"            TEXT NOT NULL,
  "gbtEligible"       BOOLEAN NOT NULL DEFAULT true,
  "dependantEligible" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "EmploymentClassPlanOverride_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NationalityPlanOverride" (
  "id"            TEXT NOT NULL,
  "benefitYearId" TEXT NOT NULL,
  "nationality"   TEXT NOT NULL,
  "standardBand"  TEXT NOT NULL,
  "productId"     TEXT NOT NULL,
  "planId"        TEXT NOT NULL,
  CONSTRAINT "NationalityPlanOverride_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FlexWalletRule" (
  "id"            TEXT NOT NULL,
  "benefitYearId" TEXT NOT NULL,
  "flexTierKey"   TEXT NOT NULL,
  "creditAmount"  DECIMAL(14,2) NOT NULL,
  "tierLabel"     TEXT NOT NULL,
  "currencyCode"  TEXT NOT NULL DEFAULT 'SGD',
  CONSTRAINT "FlexWalletRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcessingError" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "benefitYearId"    TEXT NOT NULL,
  "employeeId"       TEXT NOT NULL,
  "engine"           TEXT NOT NULL,
  "errorCode"        TEXT NOT NULL,
  "errorMessage"     TEXT NOT NULL,
  "employeeSnapshot" JSONB NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'OPEN',
  "resolvedBy"       TEXT,
  "resolvedAt"       TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcessingError_pkey" PRIMARY KEY ("id")
);

-- ----------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------

CREATE UNIQUE INDEX "GradeNormalisationMap_benefitYearId_gradeCode_key"
  ON "GradeNormalisationMap"("benefitYearId", "gradeCode");
CREATE INDEX "GradeNormalisationMap_benefitYearId_idx"
  ON "GradeNormalisationMap"("benefitYearId");

CREATE INDEX "SalaryBandRule_benefitYearId_idx"
  ON "SalaryBandRule"("benefitYearId");

CREATE UNIQUE INDEX "InsurancePlanRule_benefitYearId_standardBand_employmentType_productId_key"
  ON "InsurancePlanRule"("benefitYearId", "standardBand", "employmentType", "productId");
CREATE INDEX "InsurancePlanRule_benefitYearId_idx"
  ON "InsurancePlanRule"("benefitYearId");

CREATE UNIQUE INDEX "EmploymentClassPlanOverride_benefitYearId_employmentClass_employmentType_productId_key"
  ON "EmploymentClassPlanOverride"("benefitYearId", "employmentClass", "employmentType", "productId");
CREATE INDEX "EmploymentClassPlanOverride_benefitYearId_idx"
  ON "EmploymentClassPlanOverride"("benefitYearId");

CREATE UNIQUE INDEX "NationalityPlanOverride_benefitYearId_nationality_standardBand_productId_key"
  ON "NationalityPlanOverride"("benefitYearId", "nationality", "standardBand", "productId");
CREATE INDEX "NationalityPlanOverride_benefitYearId_idx"
  ON "NationalityPlanOverride"("benefitYearId");

CREATE UNIQUE INDEX "FlexWalletRule_benefitYearId_flexTierKey_key"
  ON "FlexWalletRule"("benefitYearId", "flexTierKey");
CREATE INDEX "FlexWalletRule_benefitYearId_idx"
  ON "FlexWalletRule"("benefitYearId");

CREATE INDEX "ProcessingError_tenantId_benefitYearId_status_idx"
  ON "ProcessingError"("tenantId", "benefitYearId", "status");
CREATE INDEX "ProcessingError_employeeId_idx"
  ON "ProcessingError"("employeeId");

-- ----------------------------------------------------------------
-- Foreign keys
-- ----------------------------------------------------------------

ALTER TABLE "GradeNormalisationMap"
  ADD CONSTRAINT "GradeNormalisationMap_benefitYearId_fkey"
  FOREIGN KEY ("benefitYearId") REFERENCES "BenefitYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SalaryBandRule"
  ADD CONSTRAINT "SalaryBandRule_benefitYearId_fkey"
  FOREIGN KEY ("benefitYearId") REFERENCES "BenefitYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InsurancePlanRule"
  ADD CONSTRAINT "InsurancePlanRule_benefitYearId_fkey"
  FOREIGN KEY ("benefitYearId") REFERENCES "BenefitYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InsurancePlanRule"
  ADD CONSTRAINT "InsurancePlanRule_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InsurancePlanRule"
  ADD CONSTRAINT "InsurancePlanRule_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmploymentClassPlanOverride"
  ADD CONSTRAINT "EmploymentClassPlanOverride_benefitYearId_fkey"
  FOREIGN KEY ("benefitYearId") REFERENCES "BenefitYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmploymentClassPlanOverride"
  ADD CONSTRAINT "EmploymentClassPlanOverride_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmploymentClassPlanOverride"
  ADD CONSTRAINT "EmploymentClassPlanOverride_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NationalityPlanOverride"
  ADD CONSTRAINT "NationalityPlanOverride_benefitYearId_fkey"
  FOREIGN KEY ("benefitYearId") REFERENCES "BenefitYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NationalityPlanOverride"
  ADD CONSTRAINT "NationalityPlanOverride_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NationalityPlanOverride"
  ADD CONSTRAINT "NationalityPlanOverride_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FlexWalletRule"
  ADD CONSTRAINT "FlexWalletRule_benefitYearId_fkey"
  FOREIGN KEY ("benefitYearId") REFERENCES "BenefitYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProcessingError"
  ADD CONSTRAINT "ProcessingError_benefitYearId_fkey"
  FOREIGN KEY ("benefitYearId") REFERENCES "BenefitYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessingError"
  ADD CONSTRAINT "ProcessingError_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ----------------------------------------------------------------
-- RLS policies (same pattern as 20260428100000_extend_rls)
-- Tenant isolation for ProcessingError via tenantId column.
-- Rule engine tables are isolated via BenefitYear → Policy → Client → Tenant.
-- ----------------------------------------------------------------

ALTER TABLE "ProcessingError" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProcessingError" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_processingerror"
  ON "ProcessingError"
  USING (
    "tenantId" = current_setting('app.current_tenant_id', true)
  );

-- Rule engine tables are NOT tenant-scoped directly (no tenantId column).
-- They rely on the application-level filter via benefitYearId + adminProcedure auth.
-- No RLS needed on these tables (same pattern as Product, Plan, PremiumRate).
