import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PressableScale } from '@/components/PressableScale';
import { buildDayShareStats, formatShareDay, type DayShareInput } from '@/features/share/dayShareStats';
import { ShareSheet, type ShareSubject } from '@/features/share/ShareSheet';
import { HIT, useColors } from '@/theme';

/** Icon button for the Today header: opens the share sheet with steps, sleep and the day's scores. */
export function ShareTodayButton({ day, nowMs }: { day: DayShareInput; nowMs: number }) {
  const colors = useColors();
  const { t, i18n } = useTranslation('sharing');
  const [open, setOpen] = useState(false);
  const subject = useMemo<ShareSubject>(
    () => ({
      heading: t('share.today.heading'),
      title: t('share.today.title'),
      subtitle: formatShareDay(nowMs),
      icon: 'sunny',
      stats: buildDayShareStats(day),
      route: [],
      caption: t('share.caption'),
      cardHint: t('share.today.hint'),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` follows the language
    [day, nowMs, i18n.language],
  );
  return (
    <>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('share.today.heading')}
        onPress={() => setOpen(true)}
        style={{ width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="share-outline" size={24} color={colors.foreground} />
      </PressableScale>
      <ShareSheet subject={subject} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
