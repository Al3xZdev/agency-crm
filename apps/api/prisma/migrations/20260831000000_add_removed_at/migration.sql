-- Soft-delete support: mark rows as removed instead of physically deleting
-- so the append-only ReviewEvent/Comment audit triggers are never violated.
ALTER TABLE "CreativeVersion" ADD COLUMN "removedAt" TIMESTAMP(3);
ALTER TABLE "Comment" ADD COLUMN "removedAt" TIMESTAMP(3);
