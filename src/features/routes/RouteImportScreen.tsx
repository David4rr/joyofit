import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { AppText } from '@/components/AppText';
import { Field } from '@/components/Input';
import { KeyValue } from '@/components/KeyValue';
import { Screen, Section } from '@/components/Screen';
import { LoadingState, Notice } from '@/components/States';
import { errorMessage } from '@/format';
import { baseNameOf } from '@/features/sharedfile/routeSharedFile';
import { spacing } from '@/theme';

import { copy, SOURCE_LABEL, untitledRouteName } from './copy';
import type { ParsedRouteFile } from './parseRouteFile';
import { pickRouteFile, readRouteFromUri } from './readRouteFile';
import { formatElevation, formatRouteDistance, routeStats, simplifyRoute } from './routeModel';
import { MAX_NAME_LENGTH } from './routeStorage';
import { saveRoute } from './routeStore';
import { RouteThumbnail } from './RouteThumbnail';

type State =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; route: ParsedRouteFile };

/**
 * `/routes/import?uri=`: reads a GPX or TCX file that was shared to JoyoFit or picked, shows what is in it and saves it as
 * a route. A file opened from outside arrives with only its address; the picker also passes the file's `name`.
 */
export function RouteImportScreen() {
  const router = useRouter();
  const { uri, name: pickedName } = useLocalSearchParams<{ uri?: string; name?: string }>();
  const [state, setState] = useState<State>(uri ? { kind: 'reading' } : { kind: 'idle' });
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // One read per incoming address, however often the screen renders or the same intent is delivered again.
  const handled = useRef<string | null>(null);

  const load = useCallback(async (address: string, fileName: string | undefined) => {
    setState({ kind: 'reading' });
    setSaveError(null);
    try {
      const result = await readRouteFromUri(address);
      if (!result.ok) {
        setState({ kind: 'failed', message: result.message });
        return;
      }
      setName(result.route.name ?? baseNameOf(fileName ?? address) ?? untitledRouteName(Date.now()));
      setState({ kind: 'ready', route: result.route });
    } catch (e) {
      setState({ kind: 'failed', message: copy.import.unreadable(errorMessage(e)) });
    }
  }, []);

  useEffect(() => {
    if (!uri || handled.current === uri) return;
    handled.current = uri;
    void load(uri, pickedName);
  }, [uri, pickedName, load]);

  const pick = async () => {
    try {
      const picked = await pickRouteFile();
      if (!picked) return;
      handled.current = picked.uri;
      await load(picked.uri, picked.name);
    } catch (e) {
      setState({ kind: 'failed', message: copy.library.pickFailed(errorMessage(e)) });
    }
  };

  const route = state.kind === 'ready' ? state.route : null;
  const stats = useMemo(() => (route ? routeStats(route.points) : null), [route]);
  const thumb = useMemo(() => (route ? simplifyRoute(route.points, 300) : []), [route]);

  const save = async () => {
    if (route === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await saveRoute({ name, source: route.format, points: route.points });
      router.replace({ pathname: '/routes/[id]', params: { id: saved.id } });
    } catch (e) {
      setSaveError(copy.import.saveFailed(errorMessage(e)));
      setSaving(false);
    }
  };

  return (
    <Screen>
      {state.kind === 'idle' ? (
        <Section title={copy.titles.import} icon="document-attach" tint="workouts">
          <AppText variant="caption" muted>
            {copy.import.pickPrompt}
          </AppText>
          <Button label={copy.import.pick} icon="folder-open" variant="primary" onPress={() => void pick()} />
        </Section>
      ) : null}

      {state.kind === 'reading' ? <LoadingState label={copy.import.reading} /> : null}

      {state.kind === 'failed' ? (
        <>
          <Notice tone="danger">{state.message}</Notice>
          <Button label={copy.import.pickAnother} icon="folder-open" onPress={() => void pick()} />
        </>
      ) : null}

      {route !== null && stats !== null ? (
        <>
          <Section title={copy.import.previewTitle} icon="trail-sign" tint="workouts">
            <View style={styles.preview}>
              <RouteThumbnail points={thumb} size={120} />
              <View style={styles.numbers}>
                <KeyValue icon="navigate" label={copy.detail.distance} value={formatRouteDistance(stats.distanceM)} />
                <KeyValue icon="trending-up" label={copy.detail.ascent} value={formatElevation(stats.ascentM)} />
                <KeyValue icon="trending-down" label={copy.detail.descent} value={formatElevation(stats.descentM === null ? null : -stats.descentM)} />
                <KeyValue icon="git-commit" label={copy.detail.points} value={String(route.points.length)} />
                <KeyValue icon="document" label={copy.detail.source} value={SOURCE_LABEL[route.format]} />
              </View>
            </View>
            {!stats.hasAltitude ? <Notice>{copy.detail.noAltitudeNote}</Notice> : null}
          </Section>
          <Section title={copy.detail.nameTitle} icon="pricetag" tint="workouts">
            <Field
              label={copy.import.nameLabel}
              value={name}
              onChangeText={setName}
              maxLength={MAX_NAME_LENGTH}
              hint={copy.import.nameHint}
              returnKeyType="done"
            />
            {saveError !== null ? <Notice tone="danger">{saveError}</Notice> : null}
            <Button label={saving ? copy.import.saving : copy.import.save} icon="save" variant="primary" loading={saving} onPress={() => void save()} />
            <Button label={copy.import.pickAnother} icon="folder-open" disabled={saving} onPress={() => void pick()} />
          </Section>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  numbers: { flex: 1, gap: 2 },
});
