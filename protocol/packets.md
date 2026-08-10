# Packet Structure — Huawei Watch Fit 4 Pro

**Confidence: UNKNOWN.** No frame format has been observed yet.

Record here once a stable frame layout is reproduced across multiple captures.

## Template (fill per observed frame kind)

```
Frame kind:    <name, e.g. COMMAND / RESPONSE / EVENT>
Confidence:    UNKNOWN | HYPOTHESIS | OBSERVED | REPRODUCED | VERIFIED

Offset  Size  Field       Meaning
0       1-2   magic       sync bytes (e.g. AA 55)
...
n       1     checksum    algorithm: <CRC8 / XOR / ...>

Example:
AA 55 01 00 04 00 12 34 56 78

Notes:
<how decoded, reproducibility, edge cases>
```

## Do not assume

- Magic bytes (`AA 55`) shown elsewhere in this repo's examples are illustrative placeholders
  from the PRD, **not** confirmed values for this watch.
- Length, command-id field width, endianness, checksum algorithm — all UNKNOWN until reproduced.
