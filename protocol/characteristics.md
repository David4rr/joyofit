# GATT Characteristics — Huawei Watch Fit 4 Pro

One row per characteristic. Record the parent service UUID, properties, and the first observed
value. Properties decoded by the app: READ, WRITE, WRITE_NO_RESPONSE, NOTIFY, INDICATE.

| Char UUID | Service UUID | Properties | First value (hex) | Confidence | Notes |
|-----------|--------------|------------|-------------------|------------|-------|
| _pending first capture_ | — | — | — | UNKNOWN | — |

## Known-standard characteristics (confirm on device)

- `0x2A00` Device Name — Generic Access.
- `0x2A19` Battery Level — Battery Service (0–100 %).
- `0x2A24` Model Number — Device Information.
- `0x2A26` Firmware Revision — Device Information.
- `0x2A27` Hardware Revision — Device Information.
- `0x2A29` Manufacturer Name — Device Information.

## Notes

- Notify/Indicate enable requires writing the CCCD (`0x2902`): `01 00` notify, `02 00` indicate,
  `00 00` disable.
- Proprietary characteristics: treat as opaque until a command is REPRODUCED.
