import { afterEach, describe, expect, it } from 'bun:test';

import { applyLocale } from '@/i18n';
import type { WeatherForecastStatus } from '@/wear';

import { forecastLine } from './forecastStatus';

const status = (patch: Partial<WeatherForecastStatus>): WeatherForecastStatus => ({
  state: 'sent',
  hours: 24,
  days: 8,
  replyCode: 100000,
  at: 1,
  ...patch,
});

afterEach(() => applyLocale('id'));

describe('forecastLine', () => {
  it('shows nothing before the first push', () => {
    expect(forecastLine(null)).toBeNull();
  });

  it('reports what was sent', () => {
    expect(forecastLine(status({}))).toBe('Prakiraan terkirim: 24 jam, 8 hari.');
    expect(forecastLine(status({ hours: 12, days: 3 }))).toBe('Prakiraan terkirim: 12 jam, 3 hari.');
  });

  it('reports what was sent in English, with plurals', async () => {
    await applyLocale('en');
    expect(forecastLine(status({}))).toBe('Forecast sent: 24 hours, 8 days.');
    expect(forecastLine(status({ hours: 1, days: 1 }))).toBe('Forecast sent: 1 hour, 1 day.');
  });

  it('says a watch without the forecast command takes current weather only', async () => {
    const line = forecastLine(status({ state: 'unsupported', hours: 0, days: 0, replyCode: null }));
    expect(line).toBe('Jam ini hanya menerima cuaca saat ini: perintah prakiraan tidak ada di daftarnya.');
    await applyLocale('en');
    expect(forecastLine(status({ state: 'unsupported', hours: 0, days: 0, replyCode: null }))).toBe(
      'This watch takes current weather only: it does not list the forecast command.',
    );
  });

  it('says when the watch did not confirm', async () => {
    expect(forecastLine(status({ state: 'unacknowledged', replyCode: null }))).toBe(
      'Jam tidak mengonfirmasi prakiraan. Cuaca saat ini sudah dikirim.',
    );
    await applyLocale('en');
    expect(forecastLine(status({ state: 'unacknowledged', replyCode: null }))).toBe(
      'The watch did not confirm the forecast. Current weather was sent.',
    );
  });

  it('formats the refusal code as 8 hex digits', async () => {
    expect(forecastLine(status({ state: 'rejected', replyCode: 0x18001 }))).toBe('Jam menolak prakiraan (code 0x00018001).');
    await applyLocale('en');
    expect(forecastLine(status({ state: 'rejected', replyCode: 0x18001 }))).toBe('The watch refused the forecast (code 0x00018001).');
  });
});
