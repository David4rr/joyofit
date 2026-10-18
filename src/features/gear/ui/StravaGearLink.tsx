import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { fetchStravaGear, StravaGearScopeError, type StravaGearItem } from '@/cloud/strava';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Notice } from '@/components/States';
import { errorMessage } from '@/format';
import { spacing } from '@/theme';
import { useStrava } from '@/state/StravaProvider';
import type { GearKind } from '../model';

export interface StravaGearLinkValue {
  id: string;
  name: string;
}

interface Props {
  kind: GearKind;
  link: StravaGearLinkValue | null;
  onChange: (link: StravaGearLinkValue | null) => void;
}

type Load = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; items: StravaGearItem[] } | { status: 'error'; message: string };

/**
 * Links one JoyoFit gear to one of the athlete's Strava shoes or bikes. The list comes from `GET /athlete` (scope
 * `profile:read_all`, asked for with a second consent) and is read only to be shown here; only the chosen id and name are kept.
 * Strava cannot create gear through its API, so an empty list says to add it on strava.com first.
 */
export function StravaGearLink({ kind, link, onChange }: Props) {
  const { t } = useTranslation('gear');
  const strava = useStrava();
  const [load, setLoad] = useState<Load>({ status: 'idle' });
  const connected = strava.settings.connectedAt !== null;

  const open = useCallback(async () => {
    setLoad({ status: 'loading' });
    try {
      setLoad({ status: 'ready', items: await fetchStravaGear() });
    } catch (e) {
      if (e instanceof StravaGearScopeError) await strava.refresh().catch(() => {});
      setLoad({ status: 'error', message: errorMessage(e) });
    }
  }, [strava]);

  if (kind === 'other') return <AppText variant="caption" muted>{t('strava.otherNoLink')}</AppText>;
  if (!connected) return <Notice>{t('strava.notConnected')}</Notice>;
  if (!strava.settings.gearScope && !link) {
    return (
      <View style={styles.box}>
        <AppText variant="caption" muted>
          {t('strava.gearAccess.off')}
        </AppText>
        <Button label={t('strava.gearAccess.grant')} icon="key-outline" onPress={() => void strava.connect({ gear: true })} disabled={strava.busy || !strava.signedIn} loading={strava.busy} />
      </View>
    );
  }

  const wanted = kind === 'bike' ? 'bike' : 'shoes';
  const items = load.status === 'ready' ? load.items.filter((item) => item.kind === wanted) : [];

  return (
    <View style={styles.box}>
      <AppText variant="body">{link ? t('strava.linked', { name: link.name }) : t('strava.unlinked')}</AppText>
      <AppText variant="caption" muted>
        {t('strava.note')}
      </AppText>
      {load.status === 'idle' || load.status === 'error' || (load.status === 'ready' && link) ? (
        <View style={styles.row}>
          <Button label={link ? t(wanted === 'bike' ? 'strava.pickBike' : 'strava.pickShoes') : t('strava.link')} icon="link" onPress={() => void open()} />
          {link ? <Button label={t('strava.unlink')} variant="ghost" onPress={() => onChange(null)} /> : null}
        </View>
      ) : null}
      {load.status === 'loading' ? <AppText variant="caption" muted>{t('strava.loading')}</AppText> : null}
      {load.status === 'error' ? <Notice tone="danger">{t('strava.error', { error: load.message })}</Notice> : null}
      {load.status === 'ready' && items.length === 0 ? <Notice>{t('strava.empty', { kind: t(`kinds.${wanted}`).toLowerCase() })}</Notice> : null}
      {load.status === 'ready' && items.length > 0 ? (
        <View style={styles.chips}>
          {items.map((item) => (
            <Chip
              key={item.id}
              label={item.name}
              selected={link?.id === item.id}
              onPress={() => {
                onChange({ id: item.id, name: item.name });
                setLoad({ status: 'idle' });
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
