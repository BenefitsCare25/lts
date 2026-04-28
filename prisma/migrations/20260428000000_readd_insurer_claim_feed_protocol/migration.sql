-- Re-introduce Insurer.claimFeedProtocol for the S35 TPA claims feed
-- pipeline. Per ADR 0004, the column was dropped at Phase 1B (S8)
-- because the codebase had no consumer; S35 adds the consumer.
-- Defaults to NULL — existing rows are unaffected and the admin UI
-- can backfill values per insurer.
ALTER TABLE "Insurer" ADD COLUMN "claimFeedProtocol" TEXT;
