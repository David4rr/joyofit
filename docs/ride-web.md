# Ride on the web: the browser game

fit.joyorogo.com/ride. A 3D indoor ride in the browser. The JoyoFit phone is the sensor bridge (wire protocol: `src/features/ride/protocol.ts`, relay: `server/src/ride`), the game is the display and fun layer, and the phone stays the source of truth for the workout.

## Layout

- `site/ride.html` is its own Vite entry. `three` and the game live only in `site/src/ride/**`; the landing bundle (`index.html`) does not import any of it. Production serves `dist/ride.html` at `/ride`; `vite.config.ts` maps `/ride` to it in dev.
- The game imports `protocol.ts` and `physics.ts` from `src/features/ride` by relative path (`server.fs.allow` and `tsconfig.json` include those two files). Neither is copied.

| File | What it does |
|---|---|
| `routes.ts` | Routes as data: elevation and heading control points, plus sprint and KOM segments. Pantai (flat, 12 km), Bukit (hilly, 9 km), Kebun (short, 3 km). |
| `track.ts` | Smooth (monotone cubic) elevation and plan curve sampled every 4 m. |
| `terrain.ts`, `scenery.ts`, `world.ts` | Terrain ribbon along the road with per-vertex colour, instanced trees, posts and rocks per 512 m chunk, sky dome, clouds, sea, gantries. |
| `avatar.ts` | Low-poly cyclist with 2-bone leg IK; used for the rider and the ghost. |
| `engine.ts` | Renderer, chase / follow / side cameras, adaptive pixel ratio, FPS stats. |
| `session.ts` | Pure ride state: countdown, physics step, distance, climb, laps, segments, ghost, drafting, summary. No DOM. |
| `game.ts` | Glue: source, session, engine, relay messages, localStorage records. |
| `sources/` | `room.ts` (relay), `demo.ts` (synthetic rider), `ble.ts` + `ble-parse.ts` (Web Bluetooth HR 0x180D, CSC 0x1816 crank cadence). |
| `ui/`, `ride.css`, `i18n.ts` | Pair, route, HUD, summary screens. Indonesian and English dictionaries (English must define every key). |

## Run it

```sh
# relay (needs the fake JoyoRogo sign-in the sim starts on :8788, or pass your own port)
cd server && bunx wrangler dev --var JOYOROGO_AUTH_URL:http://localhost:8788   # :8787
cd site && bunx vite                                                            # /ride
# open http://localhost:5173/ride?relay=http://localhost:8787
bun scripts/ride-sim.ts --code <the 6 digits on screen>                         # fake phone
```

- `?relay=<url>` overrides the API base (default `https://api.fit.joyorogo.com`, or `VITE_RIDE_API`).
- `?lang=id|en`, `?debug` (exposes `window.__ride = { game, engine }`).
- "Coba mode demo" needs no phone. The demo panel has a cadence slider.
- Tests: `cd site && bun test src/ride` (BLE parsers, track, session, room source).

## How a ride works

1. Cadence comes from the room, demo or Bluetooth. A reading older than 3 s counts as no data and the rider coasts.
2. `physics.stepSpeed` turns cadence x the chosen virtual gear into speed on the current grade. Power is an estimate and is labelled "estimasi" / "estimated" in the HUD and the summary. A real `pwr` reading from a meter is shown as "terukur" / "measured" and drives speed instead.
3. Gears: the game picks the gear for the grade until the first shift (`climbGear`, docs/ride.md); then keyboard up / down, the HUD buttons, or the phone (`gear` messages). Space or Esc pauses, L laps, C changes camera, F fullscreen.
4. Heart rate colours the HUD and adds a vignette at zones 4 to 5. It never feeds the physics.
5. At the finish or "Akhiri latihan" the game sends `sum` (distance, climb, route, laps) and then `ctl stop`. The relay keeps `sum` until the phone acknowledges it.
6. Records in localStorage: the best run per route (`joyofit-ride-ghost:<route>`, one distance per second) is the ghost; segment bests are `joyofit-ride-segments:<route>`. Riding 1.5 to 12 m behind a live ghost lowers air drag (`cdaScale` 0.7) and shows a slipstream hint.

## Quality and accessibility

- Quality presets `low` (TV default, detected from the user agent), `medium`, `high`; the frame loop lowers the pixel ratio when frames run long and restores it with headroom.
- `prefers-reduced-motion`: no camera shake, no speed FOV kick, no preview sway, no cloud drift, and UI motion is reduced to a fade.
- HUD sizes scale from one unit (`--u`) so it reads at TV distance.
