-- Staff comment editing (PR4 slice): allow the owning staff user to rewrite
-- the `body` of their own comments. The soft-delete marker stays supported and
-- every other column remains byte-for-byte frozen.
ALTER TABLE "Comment" ADD COLUMN "editedAt" TIMESTAMPTZ(6);

-- Extend forbid_mutation(): Comment UPDATE is now allowed when the ONLY
-- changed columns are the soft-delete marker ("removedAt"), the comment body
-- ("body") and its edit timestamp ("editedAt"). Everything else — authorship,
-- scoping, anchor payload, resolution flag and creation time — must remain
-- IS NOT DISTINCT FROM the stored row, or the UPDATE is rejected. Comment
-- DELETE and ReviewEvent mutations remain strictly forbidden.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  -- ReviewEvent: strictly append-only, no update and no delete ever.
  IF TG_TABLE_NAME = 'ReviewEvent' THEN
    RAISE EXCEPTION 'append-only table: % mutations are forbidden', TG_TABLE_NAME;
  END IF;

  -- Comment rows can never be deleted.
  IF TG_TABLE_NAME = 'Comment' AND TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only table: % mutations are forbidden', TG_TABLE_NAME;
  END IF;

  -- Comment UPDATE: allowed ONLY for the removedAt soft-delete marker, the
  -- body rewrite (editedAt set at the same time) — every content and scoping
  -- column must remain byte-for-byte unchanged.
  IF TG_TABLE_NAME = 'Comment' AND TG_OP = 'UPDATE' THEN
    IF NEW."versionId"      IS NOT DISTINCT FROM OLD."versionId"
      AND NEW."agencyId"     IS NOT DISTINCT FROM OLD."agencyId"
      AND NEW."clientId"     IS NOT DISTINCT FROM OLD."clientId"
      AND NEW."authorType"   IS NOT DISTINCT FROM OLD."authorType"
      AND NEW."authorUserId" IS NOT DISTINCT FROM OLD."authorUserId"
      AND NEW."authorLabel"  IS NOT DISTINCT FROM OLD."authorLabel"
      AND NEW."anchor"       IS NOT DISTINCT FROM OLD."anchor"
      AND NEW."posX"         IS NOT DISTINCT FROM OLD."posX"
      AND NEW."posY"         IS NOT DISTINCT FROM OLD."posY"
      AND NEW."startMs"      IS NOT DISTINCT FROM OLD."startMs"
      AND NEW."endMs"        IS NOT DISTINCT FROM OLD."endMs"
      AND NEW."strokes"      IS NOT DISTINCT FROM OLD."strokes"
      AND NEW."resolved"     IS NOT DISTINCT FROM OLD."resolved"
      AND NEW."createdAt"    IS NOT DISTINCT FROM OLD."createdAt"
      AND (NEW."removedAt" IS DISTINCT FROM OLD."removedAt"
        OR NEW."body"     IS DISTINCT FROM OLD."body"
        OR NEW."editedAt" IS DISTINCT FROM OLD."editedAt")
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'append-only table: % mutations are forbidden', TG_TABLE_NAME;
  END IF;

  -- Safety net for any other trigger/table wiring.
  RAISE EXCEPTION 'append-only table: % mutations are forbidden', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;