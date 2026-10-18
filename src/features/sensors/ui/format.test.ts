import { describe, expect, it } from 'bun:test';

import { applyLocale } from '@/i18n';

import {
  batteryLabel,
  errorCode,
  kindsLabel,
  linkHint,
  needsWheelSize,
  parseWheelMm,
  radioProblem,
  readingLine,
  readingParts,
  scanName,
  sensorIcon,
  signalBars,
  signalLevel,
  sortKinds,
  wheelPresetOf,
} from './format';

describe('kinds', () => {
  it('lists kinds in one stable order whatever order they came in', () => {
    expect(sortKinds(['rsc', 'csc', 'hr', 'power'])).toEqual(['hr', 'power', 'csc', 'rsc']);
    expect(sortKinds([])).toEqual([]);
  });

  it('labels them and picks the first kind for the icon', () => {
    expect(kindsLabel(['csc', 'hr'])).toBe('Detak jantung, Kecepatan dan kadence');
    expect(sensorIcon(['csc', 'power'])).toBe('flash');
    expect(sensorIcon([])).toBe('bluetooth');
  });

  it('speaks English when asked', async () => {
    await applyLocale('en');
    expect(kindsLabel(['rsc', 'power'])).toBe('Power, Running pod');
    await applyLocale('id');
  });
});

describe('signal', () => {
  it('maps dBm to 1..4 bars at the thresholds', () => {
    expect(signalBars(-40)).toBe(4);
    expect(signalBars(-60)).toBe(4);
    expect(signalBars(-61)).toBe(3);
    expect(signalBars(-70)).toBe(3);
    expect(signalBars(-71)).toBe(2);
    expect(signalBars(-80)).toBe(2);
    expect(signalBars(-81)).toBe(1);
    expect(signalBars(-100)).toBe(1);
  });

  it('names the level after the bars', () => {
    expect(signalLevel(-50)).toBe('strong');
    expect(signalLevel(-65)).toBe('good');
    expect(signalLevel(-75)).toBe('fair');
    expect(signalLevel(-95)).toBe('weak');
  });
});

describe('battery and names', () => {
  it('shows the battery only when it is known', () => {
    expect(batteryLabel(null)).toBeNull();
    expect(batteryLabel(80)).toBe('Baterai 80%');
    expect(batteryLabel(0)).toBe('Baterai 0%');
  });

  it('falls back to the id tail for a sensor without a name', () => {
    expect(scanName({ id: 'AA:BB:CC:DD:EE:FF', name: 'Polar H10 7A3B' })).toBe('Polar H10 7A3B');
    expect(scanName({ id: 'AA:BB:CC:DD:EE:FF', name: null })).toBe('Sensor tanpa nama (EE:FF)');
    expect(scanName({ id: 'AA:BB:CC:DD:EE:FF', name: '  ' })).toBe('Sensor tanpa nama (EE:FF)');
  });
});

describe('reading line', () => {
  it('joins the values a sensor reports', () => {
    expect(readingLine({ hr: 72, hrContact: 'detected' })).toBe('72 bpm');
    expect(readingLine({ watts: 185, cadenceRpm: 84 })).toBe('185 W · 84 rpm');
    expect(readingLine({ speedMps: 8, cadenceRpm: 90 })).toBe('90 rpm · 28,8 km/j');
    expect(readingLine({ podSpeedMps: 3, podCadenceSpm: 170 })).toBe('10,8 km/j · 170 spm');
  });

  it('keeps a zero (a rider who stopped) and rounds the rest', () => {
    expect(readingLine({ watts: 0, cadenceRpm: 0 })).toBe('0 W · 0 rpm');
    expect(readingLine({ hr: 71.6 })).toBe('72 bpm');
  });

  it('leaves out a heart rate the strap says is not on skin', () => {
    expect(readingParts({ hr: 150, hrContact: 'lost' })).toEqual([]);
    expect(readingParts({ hr: 150, hrContact: 'unsupported' })).toEqual(['150 bpm']);
  });

  it('is null with nothing to show', () => {
    expect(readingLine({})).toBeNull();
  });
});

describe('link hint', () => {
  const link = (over: Partial<Parameters<typeof linkHint>[0]>): Parameters<typeof linkHint>[0] => ({
    state: 'connected',
    error: null,
    contact: null,
    preview: {},
    ...over,
  });

  it('tells apart a lost signal from a connection that never came up', () => {
    expect(linkHint(link({ state: 'connecting', error: 'x' }), ['hr'])).toBe('signalLost');
    expect(linkHint(link({ state: 'connecting' }), ['hr'])).toBeNull();
    expect(linkHint(link({ state: 'disconnected', error: 'x' }), ['hr'])).toBe('failed');
    expect(linkHint(link({ state: 'disconnected' }), ['hr'])).toBeNull();
  });

  it('asks a quiet strap for skin contact, then for a heartbeat', () => {
    expect(linkHint(link({ preview: { hr: 80, hrContact: 'lost' } }), ['hr'])).toBe('contactLost');
    expect(linkHint(link({ contact: 'lost' }), ['hr'])).toBe('contactLost');
    expect(linkHint(link({}), ['hr'])).toBe('waitingHr');
  });

  it('asks a quiet bike sensor to be woken, a pod to be moved, and says nothing once values flow', () => {
    expect(linkHint(link({}), ['csc'])).toBe('waitingBike');
    expect(linkHint(link({}), ['power', 'csc'])).toBe('waitingBike');
    expect(linkHint(link({}), ['rsc'])).toBe('waitingPod');
    expect(linkHint(link({ preview: { watts: 100 } }), ['power'])).toBeNull();
    expect(linkHint(link({}), [])).toBeNull();
  });
});

describe('wheel size', () => {
  it('accepts four digits inside the range a bike wheel can have', () => {
    expect(parseWheelMm('2105')).toBe(2105);
    expect(parseWheelMm(' 1000 ')).toBe(1000);
    expect(parseWheelMm('3000')).toBe(3000);
  });

  it('rejects everything else', () => {
    expect(parseWheelMm('')).toBeNull();
    expect(parseWheelMm('999')).toBeNull();
    expect(parseWheelMm('3001')).toBeNull();
    expect(parseWheelMm('21.05')).toBeNull();
    expect(parseWheelMm('2e3')).toBeNull();
    expect(parseWheelMm('-2105')).toBeNull();
  });

  it('finds the preset of a size, none for a custom one', () => {
    expect(wheelPresetOf(2105)).toBe('700x25c');
    expect(wheelPresetOf(2288)).toBe('29x2.1');
    expect(wheelPresetOf(2100)).toBeNull();
  });

  it('only a speed or power sensor needs it', () => {
    expect(needsWheelSize(['hr'])).toBe(false);
    expect(needsWheelSize(['rsc'])).toBe(false);
    expect(needsWheelSize(['hr', 'csc'])).toBe(true);
    expect(needsWheelSize(['power'])).toBe(true);
  });
});

describe('radio problem', () => {
  const hub = (bluetooth: 'on' | 'off' | 'unauthorized' | 'unsupported' | 'unknown', scanError: string | null = null) => ({ bluetooth, scanError });

  it('reads the code of a native error', () => {
    expect(errorCode({ code: 'ERR_BLUETOOTH_OFF', message: 'x' })).toBe('ERR_BLUETOOTH_OFF');
    expect(errorCode(new Error('x'))).toBe('ERR_UNKNOWN');
    expect(errorCode(null)).toBe('ERR_UNKNOWN');
    expect(errorCode('ERR_BLUETOOTH_OFF')).toBe('ERR_UNKNOWN');
  });

  it('has nothing to say while all is well', () => {
    expect(radioProblem(hub('on'), 'granted', null)).toBeNull();
    expect(radioProblem(hub('unknown'), null, null)).toBeNull();
  });

  it('puts a missing permission before everything else', () => {
    expect(radioProblem(hub('off'), 'blocked', null)).toBe('permission');
    expect(radioProblem(hub('on'), 'denied', null)).toBe('permission');
    expect(radioProblem(hub('unauthorized'), null, null)).toBe('permission');
    expect(radioProblem(hub('on', 'ERR_BLUETOOTH_PERMISSION'), 'granted', null)).toBe('permission');
  });

  it('names the radio being off or missing', () => {
    expect(radioProblem(hub('unsupported'), null, null)).toBe('unsupported');
    expect(radioProblem(hub('off'), null, null)).toBe('bluetoothOff');
    expect(radioProblem(hub('on', 'ERR_BLUETOOTH_OFF'), null, null)).toBe('bluetoothOff');
    expect(radioProblem(hub('unknown'), null, { code: 'ERR_BLUETOOTH_OFF', during: 'connect' })).toBe('bluetoothOff');
  });

  it('tells a failed scan from a failed connect', () => {
    expect(radioProblem(hub('on', 'ERR_BLUETOOTH_UNAVAILABLE'), null, null)).toBe('scanFailed');
    expect(radioProblem(hub('on'), null, { code: 'ERR_UNKNOWN', during: 'scan' })).toBe('scanFailed');
    expect(radioProblem(hub('on'), null, { code: 'ERR_UNKNOWN', during: 'connect' })).toBe('connectFailed');
  });
});
