import { Share } from 'react-native';

import { reportText } from '@/features/device/supportIssue';
import { t } from '@/i18n';
import { HuaweiWear } from '@/wear';

/** Opens the share sheet with the support report: the summary and the whole Bluetooth log of the last connect. */
export async function shareSupportReport(): Promise<void> {
  const report = await HuaweiWear.getSupportReport();
  await Share.share({ title: t('watch:device.support.shareTitle'), message: reportText(report) });
}
