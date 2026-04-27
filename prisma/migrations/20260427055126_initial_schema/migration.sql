-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('TENANT_ADMIN', 'CATALOGUE_ADMIN', 'BROKER_ADMIN', 'CLIENT_HR', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BenefitYearState" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "workosUserId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Country" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "uenPattern" TEXT,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Currency" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Industry" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentCode" TEXT,

    CONSTRAINT "Industry_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "EmployeeSchema" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fields" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeSchema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorLibrary" (
    "dataType" TEXT NOT NULL,
    "operators" JSONB NOT NULL,

    CONSTRAINT "OperatorLibrary_pkey" PRIMARY KEY ("dataType")
);

-- CreateTable
CREATE TABLE "Insurer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "productsSupported" TEXT[],
    "claimFeedProtocol" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Insurer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TPA" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "supportedInsurerIds" TEXT[],
    "feedFormat" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TPA_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pool" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolMembership" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "insurerId" TEXT NOT NULL,
    "shareBps" INTEGER,

    CONSTRAINT "PoolMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schema" JSONB NOT NULL,
    "planSchema" JSONB NOT NULL,
    "premiumStrategy" TEXT NOT NULL,
    "parsingRules" JSONB,
    "displayTemplate" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProductType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradingName" TEXT,
    "uen" TEXT NOT NULL,
    "countryOfIncorporation" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "industry" TEXT,
    "primaryContactName" TEXT,
    "primaryContactEmail" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "versionId" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitYear" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "state" "BenefitYearState" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,

    CONSTRAINT "BenefitYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyEntity" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "address" TEXT,
    "headcountEstimate" INTEGER,
    "isMaster" BOOLEAN NOT NULL DEFAULT false,
    "rateOverrides" JSONB,

    CONSTRAINT "PolicyEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitGroup" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "predicate" JSONB NOT NULL,
    "description" TEXT,

    CONSTRAINT "BenefitGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "benefitYearId" TEXT NOT NULL,
    "productTypeId" TEXT NOT NULL,
    "insurerId" TEXT NOT NULL,
    "poolId" TEXT,
    "tpaId" TEXT,
    "data" JSONB NOT NULL,
    "versionId" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coverBasis" TEXT NOT NULL,
    "stacksOn" TEXT,
    "selectionMode" TEXT NOT NULL DEFAULT 'broker_default',
    "schedule" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductEligibility" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "benefitGroupId" TEXT NOT NULL,
    "defaultPlanId" TEXT NOT NULL,

    CONSTRAINT "ProductEligibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumRate" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "groupId" TEXT,
    "coverTier" TEXT,
    "ratePerThousand" DECIMAL(12,4),
    "fixedAmount" DECIMAL(14,2),

    CONSTRAINT "PremiumRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "hireDate" TIMESTAMP(3) NOT NULL,
    "terminationDate" TIMESTAMP(3),

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dependent" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "relation" TEXT NOT NULL,

    CONSTRAINT "Dependent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "benefitGroupId" TEXT NOT NULL,
    "coverTier" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementSlipUpload" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "insurerTemplate" TEXT,
    "parseStatus" TEXT NOT NULL,
    "parseResult" JSONB,
    "issues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlacementSlipUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_workosUserId_key" ON "User"("workosUserId");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeSchema_tenantId_key" ON "EmployeeSchema"("tenantId");

-- CreateIndex
CREATE INDEX "Insurer_tenantId_idx" ON "Insurer"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Insurer_tenantId_code_key" ON "Insurer"("tenantId", "code");

-- CreateIndex
CREATE INDEX "TPA_tenantId_idx" ON "TPA"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TPA_tenantId_code_key" ON "TPA"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Pool_tenantId_idx" ON "Pool"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PoolMembership_poolId_insurerId_key" ON "PoolMembership"("poolId", "insurerId");

-- CreateIndex
CREATE INDEX "ProductType_tenantId_idx" ON "ProductType"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductType_tenantId_code_key" ON "ProductType"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Client_tenantId_idx" ON "Client"("tenantId");

-- CreateIndex
CREATE INDEX "Policy_clientId_idx" ON "Policy"("clientId");

-- CreateIndex
CREATE INDEX "BenefitYear_policyId_idx" ON "BenefitYear"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitYear_policyId_startDate_key" ON "BenefitYear"("policyId", "startDate");

-- CreateIndex
CREATE INDEX "PolicyEntity_policyId_idx" ON "PolicyEntity"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyEntity_policyId_policyNumber_key" ON "PolicyEntity"("policyId", "policyNumber");

-- CreateIndex
CREATE INDEX "BenefitGroup_policyId_idx" ON "BenefitGroup"("policyId");

-- CreateIndex
CREATE INDEX "Product_benefitYearId_idx" ON "Product"("benefitYearId");

-- CreateIndex
CREATE INDEX "Product_productTypeId_idx" ON "Product"("productTypeId");

-- CreateIndex
CREATE INDEX "Plan_productId_idx" ON "Plan"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_productId_code_key" ON "Plan"("productId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductEligibility_productId_benefitGroupId_key" ON "ProductEligibility"("productId", "benefitGroupId");

-- CreateIndex
CREATE INDEX "PremiumRate_productId_idx" ON "PremiumRate"("productId");

-- CreateIndex
CREATE INDEX "Employee_clientId_idx" ON "Employee"("clientId");

-- CreateIndex
CREATE INDEX "Dependent_employeeId_idx" ON "Dependent"("employeeId");

-- CreateIndex
CREATE INDEX "Enrollment_employeeId_idx" ON "Enrollment"("employeeId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "PlacementSlipUpload_clientId_idx" ON "PlacementSlipUpload"("clientId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSchema" ADD CONSTRAINT "EmployeeSchema_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insurer" ADD CONSTRAINT "Insurer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TPA" ADD CONSTRAINT "TPA_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pool" ADD CONSTRAINT "Pool_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolMembership" ADD CONSTRAINT "PoolMembership_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolMembership" ADD CONSTRAINT "PoolMembership_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "Insurer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductType" ADD CONSTRAINT "ProductType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitYear" ADD CONSTRAINT "BenefitYear_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyEntity" ADD CONSTRAINT "PolicyEntity_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitGroup" ADD CONSTRAINT "BenefitGroup_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_benefitYearId_fkey" FOREIGN KEY ("benefitYearId") REFERENCES "BenefitYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_productTypeId_fkey" FOREIGN KEY ("productTypeId") REFERENCES "ProductType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_stacksOn_fkey" FOREIGN KEY ("stacksOn") REFERENCES "Plan"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProductEligibility" ADD CONSTRAINT "ProductEligibility_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremiumRate" ADD CONSTRAINT "PremiumRate_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dependent" ADD CONSTRAINT "Dependent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
