import { describe, expect, it } from 'bun:test';
import { CrcCalculator } from '@garmin/fitsdk';

import { FIT_EPOCH_OFFSET, fitCrc, FitWriter, toFitTime, toSemicircles } from './fitEncoder';
import { decodeFit } from './testDecode';

const RECORD = 20;
const FILE_ID = 0;

/** A record message with every numeric field type the encoder writes. */
function recordFile(values: { lat?: number | null; alt?: number | null; hr?: number | null; distance?: number | null; timestamp?: number }[]) {
  const fit = new FitWriter();
  const record = fit.define(0, RECORD, [
    { num: 253, type: 'uint32' },
    { num: 0, type: 'sint32' },
    { num: 2, type: 'uint16' },
    { num: 3, type: 'uint8' },
    { num: 5, type: 'uint32' },
  ]);
  values.forEach((v, i) => fit.write(record, [v.timestamp ?? i, v.lat, v.alt, v.hr, v.distance]));
  return fit.finish();
}

describe('fitCrc', () => {
  it('matches the FIT SDK on arbitrary bytes, whole and in ranges', () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37 + (i >> 3) * 11) & 0xff);
    expect(fitCrc(bytes)).toBe(CrcCalculator.calculateCRC(bytes, 0, bytes.length));
    expect(fitCrc(bytes, 12, 700)).toBe(CrcCalculator.calculateCRC(bytes, 12, 700));
    expect(fitCrc(new Uint8Array(0))).toBe(0);
  });

  it('can continue from a previous value', () => {
    const bytes = Uint8Array.from({ length: 64 }, (_, i) => i * 3);
    expect(fitCrc(bytes, 32, 64, fitCrc(bytes, 0, 32))).toBe(fitCrc(bytes));
  });
});

describe('time and position units', () => {
  it('counts seconds from 1989-12-31T00:00:00Z', () => {
    expect(FIT_EPOCH_OFFSET).toBe(Date.UTC(1989, 11, 31) / 1000);
    expect(toFitTime(FIT_EPOCH_OFFSET)).toBe(0);
    expect(toFitTime(FIT_EPOCH_OFFSET + 86_400)).toBe(86_400);
  });

  it('is 2^31 semicircles per 180 degrees', () => {
    expect(toSemicircles(0)).toBe(0);
    expect(toSemicircles(90)).toBe(2 ** 30);
    expect(toSemicircles(-90)).toBe(-(2 ** 30));
  });
});

describe('FitWriter file', () => {
  it('writes a header, messages and two CRCs a FIT decoder accepts', () => {
    const bytes = recordFile([{ lat: 1, alt: 10, hr: 80, distance: 5 }]);
    expect(bytes[0]).toBe(14);
    expect(bytes[1]).toBe(0x20);
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('.FIT');
    const dataSize = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
    expect(bytes.length).toBe(14 + dataSize + 2);
    const decoded = decodeFit(bytes);
    expect(decoded.integrity).toBe(true);
    expect(decoded.errors).toEqual([]);
  });

  it('is rejected after a byte changes (the CRCs are real)', () => {
    const bytes = recordFile([{ lat: 1, alt: 10, hr: 80, distance: 5 }]);
    const body = bytes.slice();
    body[body.length - 6] = (body[body.length - 6] as number) ^ 0xff;
    expect(decodeFit(body).integrity).toBe(false);
    const header = bytes.slice();
    header[5] = (header[5] as number) ^ 0x01;
    expect(decodeFit(header).integrity).toBe(false);
  });

  it('round-trips numbers of every field type, negative and large ones included', () => {
    const bytes = recordFile([
      { timestamp: 1_160_992_416, lat: -73_968_881, alt: (123.4 + 500) * 5, hr: 154, distance: 123_456_789 },
      { timestamp: 4_000_000_000, lat: 2_147_483_000, alt: 0, hr: 0, distance: 4_000_000_000 },
    ]);
    const { messages, errors } = decodeFit(bytes);
    expect(errors).toEqual([]);
    const [a, b] = messages.recordMesgs ?? [];
    expect(a?.timestamp).toBe(1_160_992_416);
    expect(a?.positionLat).toBe(-73_968_881);
    expect(a?.altitude).toBeCloseTo(123.4, 1);
    expect(a?.heartRate).toBe(154);
    expect(a?.distance).toBeCloseTo(1_234_567.89, 2);
    expect(b?.timestamp).toBe(4_000_000_000);
    expect(b?.positionLat).toBe(2_147_483_000);
    expect(b?.distance).toBe(40_000_000);
    expect(b?.heartRate).toBe(0);
  });

  it('writes null, NaN and infinity as the invalid value, which a reader sees as missing', () => {
    const bytes = recordFile([{ lat: null, alt: Number.NaN, hr: undefined, distance: Number.POSITIVE_INFINITY }]);
    const record = decodeFit(bytes).messages.recordMesgs?.[0];
    expect(record?.timestamp).toBe(0);
    expect(record?.positionLat).toBeUndefined();
    expect(record?.altitude).toBeUndefined();
    expect(record?.heartRate).toBeUndefined();
    expect(record?.distance).toBeUndefined();
  });

  it('clamps out-of-range numbers and never lets a real value read as invalid', () => {
    const bytes = recordFile([{ lat: 1e12, alt: -5, hr: 255, distance: 2 ** 40 }, { lat: -1e12, alt: 70_000, hr: 1000 }]);
    const [a, b] = decodeFit(bytes).messages.recordMesgs ?? [];
    expect(a?.positionLat).toBe(2_147_483_646);
    expect(a?.altitude).toBe(-500);
    expect(a?.heartRate).toBe(254);
    expect(a?.distance).toBe(42_949_672.94);
    expect(b?.positionLat).toBe(-(2 ** 31));
    expect(b?.altitude).toBeCloseTo(65_534 / 5 - 500, 1);
    expect(b?.heartRate).toBe(254);
  });

  it('writes strings NUL-terminated, cuts them to the field and replaces what is not ASCII', () => {
    const fit = new FitWriter();
    const definition = fit.define(0, FILE_ID, [
      { num: 0, type: 'enum' },
      { num: 3, type: 'uint32z' },
      { num: 8, type: 'string', size: 8 },
    ]);
    fit.write(definition, [4, 0, 'JoyoFit']);
    fit.write(definition, [4, 7, 'Läuft zu lang']);
    const [a, b] = decodeFit(fit.finish()).messages.fileIdMesgs ?? [];
    expect(a?.productName).toBe('JoyoFit');
    expect(a?.serialNumber).toBeUndefined();
    expect(b?.productName).toBe('L?uft z');
    expect(b?.serialNumber).toBe(7);
  });

  it('grows past its first buffer', () => {
    const many = Array.from({ length: 6000 }, (_, i) => ({ lat: i, alt: 10, hr: 100, distance: i }));
    const { messages, errors, integrity } = decodeFit(recordFile(many));
    expect(integrity).toBe(true);
    expect(errors).toEqual([]);
    expect(messages.recordMesgs?.length).toBe(6000);
    expect(messages.recordMesgs?.[5999]?.positionLat).toBe(5999);
  });

  it('refuses a bad local type, a definition that is not the current one and a wrong value count', () => {
    const fit = new FitWriter();
    expect(() => fit.define(16, RECORD, [{ num: 253, type: 'uint32' }])).toThrow(RangeError);
    const first = fit.define(0, RECORD, [{ num: 253, type: 'uint32' }]);
    expect(() => fit.write(first, [])).toThrow(RangeError);
    fit.define(0, RECORD, [{ num: 3, type: 'uint8' }]);
    expect(() => fit.write(first, [1])).toThrow();
  });
});
