import { describe, expect, it } from 'bun:test';

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

describe('forecastLine', () => {
  it('shows nothing before the first push', () => {
    expect(forecastLine(null)).toBeNull();
  });

  it('reports what was sent', () => {
    expect(forecastLine(status({}))).toBe('Forecast sent: 24 hours, 8 days.');
    expect(forecastLine(status({ hours: 12, days: 3 }))).toBe('Forecast sent: 12 hours, 3 days.');
  });

  it('says a watch without the forecast command takes current weather only', () => {
    expect(forecastLine(status({ state: 'unsupported', hours: 0, days: 0, replyCode: null }))).toBe(
      'This watch takes current weather only: it does not list the forecast command.',
    );
  });

  it('says when the watch did not confirm', () => {
    expect(forecastLine(status({ state: 'unacknowledged', replyCode: null }))).toBe(
      'The watch did not confirm the forecast. Current weather was sent.',
    );
  });

  it('formats the refusal code as 8 hex digits', () => {
    expect(forecastLine(status({ state: 'rejected', replyCode: 0x18001 }))).toBe('The watch refused the forecast (code 0x00018001).');
  });
});
