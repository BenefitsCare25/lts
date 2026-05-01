-- =============================================================
-- Phase 1 rollback — reverses migration.sql in reverse order.
-- Manual safety net: NOT run by Prisma automatically.
-- Run against a DB clone to verify before ever touching production.
-- =============================================================

-- 4. Drop AppliedDraftSnapshot
DROP TABLE IF EXISTS "AppliedDraftSnapshot";

-- 3. Drop ExtractionAttempt
DROP TABLE IF EXISTS "ExtractionAttempt";

-- 2. Revert PremiumRate changes
ALTER TABLE "PremiumRate" DROP CONSTRAINT IF EXISTS "PremiumRate_basis_consistency";
DROP INDEX IF EXISTS "PremiumRate_productId_basis_idx";
ALTER TABLE "PremiumRate" DROP COLUMN IF EXISTS "ratePerEmployee";
ALTER TABLE "PremiumRate" DROP COLUMN IF EXISTS "estimatedAnnualEarnings";
ALTER TABLE "PremiumRate" DROP COLUMN IF EXISTS "ratePerEarningsUnit";
ALTER TABLE "PremiumRate" DROP COLUMN IF EXISTS "basis";

-- 1. Drop PlanStack (backfill rows are gone; Plan.stacksOn still holds the data)
DROP TABLE IF EXISTS "PlanStack";
