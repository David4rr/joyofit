import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ShareSheet, type ShareSubject } from '@/features/share/ShareSheet';
import { useLocale } from '@/i18n';

import type { PersonalRecord } from '../calc';
import type { Catalog } from '../catalog';
import type { StrengthWorkout } from '../types';
import { StrengthShareCard } from './StrengthShareCard';
import { strengthShareStats } from './strengthShareStats';

interface Props {
  workout: StrengthWorkout;
  catalog: Catalog;
  records: PersonalRecord[];
  visible: boolean;
  onClose: () => void;
}

/** The workout share sheet (`ShareSheet`: Story and square, dark card, photo or sticker, Instagram, copy, save, more) with the strength card. */
export function StrengthShareSheet({ workout, catalog, records, visible, onClose }: Props) {
  const { t } = useTranslation('strengthshare');
  const locale = useLocale();

  const subject = useMemo<ShareSubject>(() => {
    const stats = strengthShareStats(workout, catalog, locale, records);
    return {
      heading: t('share.heading'),
      title: stats.name,
      subtitle: stats.subtitle,
      icon: 'barbell',
      stats: [],
      route: [],
      caption: t('share.caption'),
      cardHint: t('share.hint'),
      renderCard: ({ format, background, photoUri, onPhotoStatus }) => (
        <StrengthShareCard format={format} background={background} stats={stats} photoUri={photoUri} onPhotoStatus={onPhotoStatus} />
      ),
    };
    // `t` follows the language, which `locale` tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workout, catalog, records, locale]);

  return <ShareSheet subject={subject} visible={visible} onClose={onClose} />;
}
