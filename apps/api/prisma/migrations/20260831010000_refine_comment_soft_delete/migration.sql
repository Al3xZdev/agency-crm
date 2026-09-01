-- Refine forbid_mutation(): Comment content stays immutable (append-only), but
-- the soft-delete marker column removedAt may be updated to hide a comment
-- without altering its content or scope. ReviewEvent stays strictly
-- append-only (no update, no delete). Comment DELETE stays forbidden.
--
-- All four triggers reuse this one function, so CREATE OR REPLACE updates them
-- all; no triggers are dropped or recreated.
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

  -- Comment UPDATE: allowed ONLY for the removedAt soft-delete marker.
  -- Every content and scoping column must remain byte-for-byte unchanged.
  IF TG_TABLE_NAME = 'Comment' AND TG_OP = 'UPDATE' THEN
    IF NEW.removedAt IS DISTINCT FROM OLD.removedAt
      AND NEW.versionId   IS NOT DISTINCT FROM OLD.versionId
      AND NEW.agencyId    IS NOT DISTINCT FROM OLD.agencyId
      AND NEW.clientId    IS NOT DISTINCT FROM OLD.clientId
      AND NEW.authorType  IS NOT DISTINCT FROM OLD.authorType
      AND NEW.authorUserId IS NOT DISTINCT FROM OLD.authorUserId
      AND NEW.authorLabel IS NOT DISTINCT FROM OLD.authorLabel
      AND NEW.anchor      IS NOT DISTINCT FROM OLD.anchor
      AND NEW.posX        IS NOT DISTINCT FROM OLD.posX
      AND NEW.posY        IS NOT DISTINCT FROM OLD.posY
      AND NEW.startMs     IS NOT DISTINCT FROM OLD.startMs
      AND NEW.endMs       IS NOT DISTINCT FROM OLD.endMs
      AND NEW.strokes     IS NOT DISTINCT FROM OLD.strokes
      AND NEW.body        IS NOT DISTINCT FROM OLD.body
      AND NEW.resolved    IS NOT DISTINCT FROM OLD.resolved
      AND NEW.createdAt   IS NOT DISTINCT FROM OLD.createdAt
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'append-only table: % mutations are forbidden', TG_TABLE_NAME;
  END IF;

  -- Safety net for any other trigger/table wiring.
  RAISE EXCEPTION 'append-only table: % mutations are forbidden', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
