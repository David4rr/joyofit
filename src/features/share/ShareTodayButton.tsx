import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';

import { PressableScale } from '@/components/PressableScale';
import { buildDayShareStats, formatShareDay, type DayShareInput } from '@/features/share/dayShareStats';
import { ShareSheet, type ShareSubject } from '@/features/share/ShareSheet';
import { HIT, useColors } from '@/theme';

const CAPTION = 'Tracked with JoyoFit · https://fit.joyorogo.com';

/** Icon button for the Today header: opens the share sheet with steps, sleep and the day's scores. */
export function ShareTodayButton({ day, nowMs }: { day: DayShareInput; nowMs: number }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const subject = useMemo<ShareSubject>(
    () => ({
      heading: 'Share today',
      title: 'Today',
      subtitle: formatShareDay(nowMs),
      icon: 'sunny',
      stats: buildDayShareStats(day),
      route: [],
      caption: CAPTION,
      cardHint: 'Your steps, sleep and scores on a dark JoyoFit card.',
    }),
    [day, nowMs],
  );
  return (
    <>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Share today"
        onPress={() => setOpen(true)}
        style={{ width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="share-outline" size={24} color={colors.foreground} />
      </PressableScale>
      <ShareSheet subject={subject} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
