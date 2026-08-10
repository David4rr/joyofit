# Authentication — Huawei Watch Fit 4 Pro

**Confidence: UNKNOWN.** We do not yet know what the watch requires before it will talk.

## Questions to answer experimentally

- Does plain BLE pairing suffice, or is bonding required?
- Is there application-level authentication after GATT connect?
- Challenge / response? Nonce? HMAC?
- Session key derivation? Per-session or persisted?
- Does the watch require a Huawei device id, serial, or account token?
- Is any step time-dependent (rejects replay after N seconds)?

## How to investigate

1. Pair the watch with the official Huawei Health app once (establishes bond).
2. Use WatchFit RE GATT Explorer to read/subscribe immediately after connect — note which
   characteristics respond without auth vs which return errors / silence.
3. Capture a fresh connection from Huawei Health to compare the initial handshake.
4. Replay candidate handshake bytes from the explorer; watch for response deltas.

## Status

| Mechanism              | Confidence | Notes |
|------------------------|------------|-------|
| BLE pairing            | UNKNOWN    | — |
| Bonding                | UNKNOWN    | — |
| App-level challenge    | UNKNOWN    | — |
| Session key            | UNKNOWN    | — |
| Encryption             | UNKNOWN    | — |
| Huawei account token   | UNKNOWN    | (non-goal per PRD §3) |

Nothing here is implemented until VERIFIED.
