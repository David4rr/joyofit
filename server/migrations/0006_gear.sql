-- Gear (shoes, bikes) and their workout assignments: one JSON document per JoyoRogo user, replaced as a whole.
-- `rev` is the optimistic-concurrency counter: a write only lands when the client's baseRev equals it.
CREATE TABLE gear_doc (
  user_id TEXT PRIMARY KEY NOT NULL,
  doc TEXT NOT NULL,
  rev INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
