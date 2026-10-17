import type { WeatherForecastStatus } from '@/wear';

/** What the last forecast push did, as one line; null before the first push in this process. */
export function forecastLine(forecast: WeatherForecastStatus | null): string | null {
  if (!forecast) return null;
  switch (forecast.state) {
    case 'sent':
      return `Forecast sent: ${forecast.hours} hours, ${forecast.days} days.`;
    case 'unsupported':
      return 'This watch takes current weather only: it does not list the forecast command.';
    case 'unacknowledged':
      return 'The watch did not confirm the forecast. Current weather was sent.';
    case 'rejected': {
      const code = forecast.replyCode === null ? '' : ` (code 0x${forecast.replyCode.toString(16).toUpperCase().padStart(8, '0')})`;
      return `The watch refused the forecast${code}.`;
    }
  }
}
