-- Invite lists for the Strava sync (/strava) and the iPhone TestFlight beta (/iphone) on fit.joyorogo.com.
-- One row per (kind, email); sending the form again updates the row and keeps its status and created_at.
CREATE TABLE waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('strava', 'iphone')),
  -- Lower-cased.
  email TEXT NOT NULL,
  strava_profile TEXT,
  watch_model TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  -- Unix milliseconds.
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (kind, email)
);

-- Submissions per hour per salted IP hash (the IP itself is never stored). Rows older than a few hours are deleted
-- by the next submission.
CREATE TABLE waitlist_rate (
  ip_hash TEXT NOT NULL,
  -- Hours since the epoch.
  hour INTEGER NOT NULL,
  hits INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, hour)
) WITHOUT ROWID;
