-- DRAW comment anchors: freehand strokes drawn on a frozen video frame.
-- Strokes are stored as a JSON array of stroke objects, each with a `points`
-- array (basis points 0..10000), an optional `color` and an optional `width`.
--
-- Run by `prisma migrate deploy` in the Docker container; a hand-written
-- migration because there is no host DB access to run `prisma migrate dev`.

ALTER TYPE "CommentAnchor" ADD VALUE IF NOT EXISTS 'DRAW';
ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "strokes" JSONB;