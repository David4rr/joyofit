# WatchFit RE — Protocol Reference (living spec)

Target device: **Huawei Watch Fit 4 Pro**.

This directory is the canonical, human-readable record of what we have discovered about the
watch's BLE protocol. It exists because the protocol is undocumented; we reverse-engineer it
experimentally and write down only what we have **observed**.

## Core rule

> **Do not document what we have not observed.** (PRD §29)

A guess is allowed only at the **HYPOTHESIS** level. Nothing here is "the spec" until it is
**VERIFIED**.

## Confidence ladder

| Level        | Meaning                                                          |
|--------------|------------------------------------------------------------------|
| `UNKNOWN`    | Nothing known yet.                                               |
| `HYPOTHESIS` | Plausible guess; unsupported by capture. Not actionable.         |
| `OBSERVED`   | Seen in real traffic; correlation not yet proven.                |
| `REPRODUCED` | Replayed against the watch; same result reproduced.              |
| `VERIFIED`   | Reproduced reliably across sessions/devices/reboots. Actionable. |

Only **REPRODUCED** or **VERIFIED** entries may be sent to the watch from app code.

## Method

```
Observation → Hypothesis → Experiment → Packet correlation → Replay → Validation → Implementation
```

1. Capture BLE traffic (WatchFit RE Packet Log, or an external sniffer).
2. Correlate a user action with a packet sequence.
3. Form a command hypothesis. Record it here at `HYPOTHESIS`.
4. Replay from the GATT Explorer. Observe the response.
5. If the result matches, upgrade to `REPRODUCED`; repeat until `VERIFIED`.
6. Implement in the `protocol/` Kotlin package.

## Files

- `services.md` — discovered GATT services.
- `characteristics.md` — discovered characteristics.
- `packets.md` — frame / packet structure.
- `authentication.md` — pairing / bonding / app-level auth / challenge-response.
- `encryption.md` — session keys, cipher, IV, if any.
- `commands.md` — command catalogue (one entry per decoded command).
- `observations.md` — raw capture notes, timelines, open questions.

## Command entry template (commands.md)

```
### <NAME>

Characteristic: <uuid>
Confidence:     UNKNOWN | HYPOTHESIS | OBSERVED | REPRODUCED | VERIFIED

Request:
<hex bytes>

Response:
<hex bytes>

Notes:
<what it does, how it was confirmed, caveats>
```

## Status

**All services, characteristics, packets, and commands start at UNKNOWN.** Populate as the
watch is reverse-engineered.
