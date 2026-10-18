-- The Strava tokens moved to JoyoRogo's `strava_account` (one Strava application, one token per athlete, shared with
-- JoyoRogo): this Worker now asks JoyoRogo for them. Run only after the existing rows were copied there.
DROP TABLE strava_connection;
