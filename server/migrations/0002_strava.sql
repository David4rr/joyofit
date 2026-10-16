-- Strava connection of a JoyoRogo user. The Worker holds the client secret, so token refresh and revoke happen
-- here; the phone only ever receives the short-lived access token.
-- Rows are deleted on disconnect and when Strava reports the athlete deauthorized the app.
CREATE TABLE strava_connection (
  user_id TEXT PRIMARY KEY NOT NULL,
  athlete_id INTEGER NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  -- Unix seconds when access_token stops working.
  expires_at INTEGER NOT NULL,
  -- Space-delimited scopes the athlete granted.
  scope TEXT NOT NULL,
  -- Unix seconds of the (latest) connect; the app only auto-uploads workouts that ended after it.
  connected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX strava_connection_by_athlete ON strava_connection (athlete_id);
