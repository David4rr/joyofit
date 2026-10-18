import { useMemo } from 'react';

import type { PersonalRecord } from '@/features/strength/calc';
import type { Catalog } from '@/features/strength/catalog';
import type { StrengthWorkout } from '@/features/strength/types';
import { buildStrengthSubject } from '@/features/stickers/data/strength';
import { StickerSheet } from '@/features/stickers/ui/StickerSheet';
import { useLocale } from '@/i18n';

interface Props {
  workout: StrengthWorkout;
  catalog: Catalog;
  records: PersonalRecord[];
  visible: boolean;
  onClose: () => void;
}

/** The sticker sheet of a strength workout; the button that opens it lives with the other actions of the workout. */
export function ShareStrengthSheet({ workout, catalog, records, visible, onClose }: Props) {
  const locale = useLocale();
  const subject = useMemo(
    () => buildStrengthSubject({ workout, catalog, records, resolveMuscles: catalog.muscles }, locale),
    [workout, catalog, records, locale],
  );
  return <StickerSheet subject={subject} visible={visible} onClose={onClose} />;
}
