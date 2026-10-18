-- Family monitoring (docs/family-monitoring.md): a directional link from a watcher to a monitored person, the daily
-- summary the monitored phone uploads, and the state the alert evaluator needs. Every row is owned by a JoyoRogo user id.

-- A single-use invite. Only the hash of the code is stored. `role` is the inviter's own role.
CREATE TABLE family_invite (
  code_hash TEXT PRIMARY KEY NOT NULL,
  inviter_id TEXT NOT NULL,
  role TEXT NOT NULL,
  label TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
) WITHOUT ROWID;
CREATE INDEX family_invite_by_inviter ON family_invite (inviter_id);

CREATE TABLE family_link (
  id TEXT PRIMARY KEY NOT NULL,
  monitored_id TEXT NOT NULL,
  watcher_id TEXT NOT NULL,
  label TEXT NOT NULL,
  -- pending (nothing uploads before consent) | active | paused | revoked (rows are deleted on revoke; kept for completeness)
  status TEXT NOT NULL,
  scopes TEXT NOT NULL,
  -- unix ms; -1 = until the monitored person turns it on again
  paused_until INTEGER,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  last_viewed_at INTEGER,
  last_poked_at INTEGER,
  snooze_until INTEGER,
  -- when the cron has to look at this link again (absence rules)
  next_check_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE (monitored_id, watcher_id)
) WITHOUT ROWID;
CREATE INDEX family_link_by_watcher ON family_link (watcher_id);
CREATE INDEX family_link_due ON family_link (status, next_check_at);

-- One row per monitored user and local calendar day. Categories the person never granted stay NULL.
CREATE TABLE family_day (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  steps INTEGER,
  first_step_at INTEGER,
  resting_hr INTEGER,
  sleep_min INTEGER,
  spo2_min INTEGER,
  spo2_low_count INTEGER,
  last_sample_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, date)
) WITHOUT ROWID;

CREATE TABLE family_state (
  user_id TEXT PRIMARY KEY NOT NULL,
  phone_seen_at INTEGER,
  watch_sync_at INTEGER,
  battery INTEGER,
  tz_offset_min INTEGER NOT NULL DEFAULT 420,
  -- the exact body of the last ingest, for "Lihat data yang terkirim"
  last_payload TEXT,
  last_payload_at INTEGER
) WITHOUT ROWID;

-- Per-watcher alert settings as JSON; absent = defaults.
CREATE TABLE family_rule (
  link_id TEXT PRIMARY KEY NOT NULL,
  rules TEXT NOT NULL
) WITHOUT ROWID;

-- Anti-spam memory per link and rule: an open episode, when the last push went out, how many pushes it has had.
CREATE TABLE family_alert_state (
  link_id TEXT NOT NULL,
  rule TEXT NOT NULL,
  open_since INTEGER,
  clear_since INTEGER,
  last_sent_at INTEGER,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, rule)
) WITHOUT ROWID;

-- Every alert decision. UNIQUE (link_id, dedupe_key) is the claim taken before anything is sent.
-- status: sent | queued (quiet hours, goes out at send_after) | digest (waits for the 19:00 summary) | digested | failed
CREATE TABLE family_alert_log (
  id TEXT PRIMARY KEY NOT NULL,
  link_id TEXT NOT NULL,
  watcher_id TEXT NOT NULL,
  rule TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  at INTEGER NOT NULL,
  level TEXT NOT NULL,
  status TEXT NOT NULL,
  send_after INTEGER,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channels TEXT NOT NULL DEFAULT '',
  UNIQUE (link_id, dedupe_key)
) WITHOUT ROWID;
CREATE INDEX family_alert_log_by_link ON family_alert_log (link_id, at DESC);
CREATE INDEX family_alert_log_by_watcher ON family_alert_log (watcher_id, at DESC);
CREATE INDEX family_alert_log_pending ON family_alert_log (status, send_after);

CREATE TABLE family_push_token (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  token TEXT NOT NULL,
  platform TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id)
) WITHOUT ROWID;

-- Revocable per-device bearer tokens the monitored phone uses for ingest (also from native background code).
CREATE TABLE family_device_token (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  UNIQUE (user_id, device_id)
) WITHOUT ROWID;
CREATE INDEX family_device_token_by_user ON family_device_token (user_id);
