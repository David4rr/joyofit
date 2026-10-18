import { t } from '@/i18n';
import type { WeatherForecastStatus } from '@/wear';

/** What the last forecast push did, as one line; null before the first push in this process. */
export function forecastLine(forecast: WeatherForecastStatus | null): string | null {
  if (!forecast) return null;
  switch (forecast.state) {
    case 'sent':
      return t('settings:forecast.sent', {
        hours: t('settings:forecast.hours', { count: forecast.hours }),
        days: t('settings:forecast.days', { count: forecast.days }),
      });
    case 'unsupported':
      return t('settings:forecast.unsupported');
    case 'unacknowledged':
      return t('settings:forecast.unacknowledged');
    case 'rejected': {
      const code = forecast.replyCode === null ? '' : ` (code 0x${forecast.replyCode.toString(16).toUpperCase().padStart(8, '0')})`; // i18n-ok: protocol reply code
      return t('settings:forecast.rejected', { code });
    }
  }
}
