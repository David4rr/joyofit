import { describe, expect, test } from 'bun:test';

import type { FamilyDay, FamilyLink, FamilyWatchingItem } from '@/cloud/family';
import {
  agoLabel,
  baselineNote,
  chipLabel,
  clockLabel,
  familySettingsSubtitle,
  dataAtText,
  dateToLocalMidnightSec,
  daySeries,
  isPaused,
  newestDay,
  nextPauseEnd,
  pauseText,
  pauseUntil,
  restingHrText,
  sleepText,
  snoozeText,
  familyCardLine,
  stepsText,
  worstChip,
} from '@/features/family/format';

/** Local 2026-10-17 13:45, built from parts so the tests hold in any time zone. */
const NOW = new Date(2026, 9, 17, 13, 45).getTime();
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();

const SCOPES = { sync: true, steps: true, sleep: true, restingHr: true, spo2: false };

function item(over: Partial<FamilyWatchingItem> = {}): FamilyWatchingItem {
  return {
    id: 'l1',
    role: 'watching',
    label: 'Ibu',
    otherName: 'Dina',
    status: 'active',
    scopes: SCOPES,
    pausedUntil: null,
    acceptedAt: null,
    lastViewedAt: null,
    frozen: false,
    dataAt: null,
    chip: 'ok',
    today: null,
    ...over,
  };
}

describe('chipLabel', () => {
  test('names the three states in Indonesian', () => {
    expect(chipLabel('ok')).toBe('Baik');
    expect(chipLabel('check')).toBe('Perlu dicek');
    expect(chipLabel('nosync')).toBe('Belum sinkron');
  });
});

describe('worstChip', () => {
  test('a check outranks a missing feed, which outranks ok', () => {
    expect(worstChip([item({ chip: 'ok' }), item({ chip: 'nosync' })])).toBe('nosync');
    expect(worstChip([item({ chip: 'nosync' }), item({ chip: 'check' }), item({ chip: 'ok' })])).toBe('check');
    expect(worstChip([item({ chip: 'ok' })])).toBe('ok');
  });

  test('pending, paused, frozen and revoked links do not count', () => {
    expect(worstChip([item({ chip: 'check', status: 'pending' }), item({ chip: 'check', frozen: true })])).toBeNull();
    expect(worstChip([item({ chip: 'nosync', status: 'paused' })])).toBeNull();
    expect(worstChip([item({ chip: 'check', status: 'revoked' }), item({ chip: 'ok' })])).toBe('ok');
  });

  test('is null with nobody watched', () => {
    expect(worstChip([])).toBeNull();
  });
});

describe('familySettingsSubtitle', () => {
  test('counts the people on either side', () => {
    expect(familySettingsSubtitle(2, 1)).toBe('Memantau 2 orang, dipantau 1 orang');
    expect(familySettingsSubtitle(1, 0)).toBe('Memantau 1 orang');
    expect(familySettingsSubtitle(0, 3)).toBe('Dipantau 3 orang');
  });

  test('with nobody it invites', () => {
    expect(familySettingsSubtitle(0, 0)).toBe('Pantau kabar orang tua dari jam Huawei mereka');
  });
});

describe('familyCardLine', () => {
  test('one person who is fine is named, several are counted', () => {
    expect(familyCardLine([item({ label: 'Ibu' })])).toBe('Ibu');
    expect(familyCardLine([item({ label: 'Ibu' }), item({ label: 'Bapak' })])).toBe('2 orang dipantau');
  });

  test('with a worse chip, the people who have it are named', () => {
    expect(familyCardLine([item({ label: 'Ibu', chip: 'ok' }), item({ label: 'Bapak', chip: 'check' })])).toBe('Bapak');
    expect(familyCardLine([item({ label: 'Ibu', chip: 'nosync' }), item({ label: 'Bapak', chip: 'nosync' })])).toBe('Ibu, Bapak');
  });

  test('with nobody live it says whether a request is waiting', () => {
    expect(familyCardLine([item({ status: 'pending' })])).toBe('Menunggu persetujuan');
    expect(familyCardLine([item({ status: 'paused' })])).toBe('Belum ada data');
  });
});

describe('agoLabel', () => {
  test('counts minutes, hours and days', () => {
    expect(agoLabel(NOW - 20_000, NOW)).toBe('baru saja');
    expect(agoLabel(NOW - 5 * 60_000, NOW)).toBe('5 menit lalu');
    expect(agoLabel(NOW - 3 * 3_600_000 - 59 * 60_000, NOW)).toBe('3 jam lalu');
    expect(agoLabel(NOW - 49 * 3_600_000, NOW)).toBe('2 hari lalu');
  });

  test('a time in the future reads as just now', () => {
    expect(agoLabel(NOW + 60_000, NOW)).toBe('baru saja');
  });
});

describe('clockLabel', () => {
  test('today is the clock alone, with a dot between hour and minute', () => {
    expect(clockLabel(at(17, 10, 42), NOW)).toBe('10.42');
    expect(clockLabel(at(17, 7, 5), NOW)).toBe('07.05');
  });

  test('yesterday, tomorrow and other days say which', () => {
    expect(clockLabel(at(16, 22, 10), NOW)).toBe('kemarin 22.10');
    expect(clockLabel(at(18, 0, 0), NOW)).toBe('besok 00.00');
    expect(clockLabel(at(12, 9, 30), NOW)).toBe('12 Okt 09.30');
  });
});

describe('dataAtText', () => {
  test('matches the dashboard line', () => {
    expect(dataAtText(at(17, 10, 42), NOW)).toBe('Data per 10.42 (3 jam lalu)');
  });

  test('no data yet', () => {
    expect(dataAtText(null, NOW)).toBe('Belum ada data');
  });
});

describe('stepsText, sleepText', () => {
  test('steps use a dot for thousands', () => {
    expect(stepsText(4230)).toBe('4.230');
    expect(stepsText(980)).toBe('980');
    expect(stepsText(1_234_567)).toBe('1.234.567');
    expect(stepsText(null)).toBe('Belum ada');
  });

  test('sleep reads in hours and minutes', () => {
    expect(sleepText(425)).toBe('7 jam 5 menit');
    expect(sleepText(480)).toBe('8 jam');
    expect(sleepText(45)).toBe('45 menit');
    expect(sleepText(null)).toBe('Belum ada');
  });
});

describe('restingHrText', () => {
  test('compares with the usual value when there is one', () => {
    expect(restingHrText(62, 60)).toBe('62 bpm, biasanya 60');
    expect(restingHrText(61.6, 59.5)).toBe('62 bpm, biasanya 60');
  });

  test('without a baseline it is the reading alone', () => {
    expect(restingHrText(62, null)).toBe('62 bpm');
    expect(restingHrText(null, 60)).toBe('Belum ada');
  });
});

describe('baselineNote', () => {
  test('explains the wait until a baseline exists', () => {
    expect(baselineNote({ restingHr: null, days: 3 })).toBe('Pembanding detak istirahat butuh 7 hari data. Baru ada 3 hari.');
    expect(baselineNote({ restingHr: 60, days: 14 })).toBeNull();
  });
});

describe('pause math', () => {
  test('one hour from now', () => {
    expect(pauseUntil('hour', NOW)).toBe(NOW + 3_600_000);
  });

  test('today ends at the next local midnight', () => {
    expect(pauseUntil('today', NOW)).toBe(new Date(2026, 9, 18, 0, 0).getTime());
    expect(pauseUntil('today', at(17, 23, 59))).toBe(new Date(2026, 9, 18, 0, 0).getTime());
  });

  test('until I turn it on is -1', () => {
    expect(pauseUntil('manual', NOW)).toBe(-1);
  });

  test('a pause is running until its time passes, or for ever at -1', () => {
    expect(isPaused({ pausedUntil: null }, NOW)).toBe(false);
    expect(isPaused({ pausedUntil: NOW + 1 }, NOW)).toBe(true);
    expect(isPaused({ pausedUntil: NOW }, NOW)).toBe(false);
    expect(isPaused({ pausedUntil: -1 }, NOW)).toBe(true);
  });

  test('pauseText says until when, and nothing when not paused', () => {
    expect(pauseText(at(17, 14, 45), NOW)).toBe('Dijeda sampai 14.45');
    expect(pauseText(at(18, 0, 0), NOW)).toBe('Dijeda sampai besok 00.00');
    expect(pauseText(-1, NOW)).toBe('Dijeda sampai kamu menyalakannya lagi');
    expect(pauseText(NOW - 1, NOW)).toBeNull();
    expect(pauseText(null, NOW)).toBeNull();
  });

  test('nextPauseEnd is the soonest pause that still runs', () => {
    const links: Pick<FamilyLink, 'pausedUntil'>[] = [{ pausedUntil: -1 }, { pausedUntil: NOW + 9000 }, { pausedUntil: NOW + 3000 }, { pausedUntil: NOW - 5 }, { pausedUntil: null }];
    expect(nextPauseEnd(links, NOW)).toBe(NOW + 3000);
    expect(nextPauseEnd([{ pausedUntil: -1 }, { pausedUntil: null }], NOW)).toBeNull();
  });
});

describe('snoozeText', () => {
  test('names the end of a running snooze only', () => {
    expect(snoozeText(at(20, 9, 0), NOW)).toBe('Pemberitahuan disenyapkan sampai 20 Okt 09.00');
    expect(snoozeText(NOW - 1, NOW)).toBeNull();
    expect(snoozeText(null, NOW)).toBeNull();
  });
});

describe('daySeries', () => {
  const day = (date: string, steps: number | null): FamilyDay => ({ date, steps, restingHr: null, sleepMin: null, spo2Min: null });

  test('ends with the newest day and leaves gaps for days the server did not send', () => {
    const series = daySeries([day('2026-10-15', 100), day('2026-10-17', 300), day('2026-10-13', 50)], 5, (d) => d.steps);
    expect(series.firstDate).toBe('2026-10-13');
    expect(series.values).toEqual([50, null, 100, null, 300]);
  });

  test('a shared day with no value stays a gap', () => {
    expect(daySeries([day('2026-10-17', null)], 2, (d) => d.steps).values).toEqual([null, null]);
  });

  test('crosses a month boundary', () => {
    const series = daySeries([day('2026-11-02', 7)], 4, (d) => d.steps);
    expect(series.firstDate).toBe('2026-10-30');
    expect(series.values).toEqual([null, null, null, 7]);
  });

  test('no days, no series', () => {
    expect(daySeries([], 7, (d) => d.steps)).toEqual({ values: [], firstDate: null });
  });
});

describe('newestDay', () => {
  const day = (date: string): FamilyDay => ({ date, steps: null, restingHr: null, sleepMin: null, spo2Min: null });

  test('is the latest date whatever the order', () => {
    expect(newestDay([day('2026-10-15'), day('2026-10-17'), day('2026-10-16')])?.date).toBe('2026-10-17');
  });

  test('is null without days', () => {
    expect(newestDay([])).toBeNull();
  });
});

describe('dateToLocalMidnightSec', () => {
  test('is local midnight of the date', () => {
    expect(dateToLocalMidnightSec('2026-10-17')).toBe(Math.floor(new Date(2026, 9, 17).getTime() / 1000));
  });
});
