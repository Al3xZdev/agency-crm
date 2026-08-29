-- AlterTable: existing comments default to unresolved (false).
ALTER TABLE "Comment" ADD COLUMN "resolved" BOOLEAN NOT NULL DEFAULT false;
