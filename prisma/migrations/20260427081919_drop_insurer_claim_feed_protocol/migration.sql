-- Remove unused claim feed protocol column. Re-introduce when the
-- claims-ingestion pipeline (S35) lands; until then it carried no
-- functional behaviour and added a free-text field admins had to
-- guess values for.
ALTER TABLE "Insurer" DROP COLUMN "claimFeedProtocol";
