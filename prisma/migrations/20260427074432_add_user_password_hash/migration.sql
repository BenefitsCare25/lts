-- Add nullable passwordHash for the local-credentials auth path.
-- Nullable because (a) the future WorkOS swap won't need it, and
-- (b) it lets us seed users via invite flows that set the password
-- on first sign-in.
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
