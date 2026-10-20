-- 004_conversation_archive.sql — reversible conversation archive metadata.
ALTER TABLE conversation_meta ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE conversation_meta ADD COLUMN IF NOT EXISTS archived_at bigint;

CREATE INDEX IF NOT EXISTS idx_conversation_meta_archived
  ON conversation_meta (principal_id, archived, archived_at DESC)
  WHERE archived;
