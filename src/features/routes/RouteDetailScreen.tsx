import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field } from '@/components/Input';
import { KeyValue } from '@/components/KeyValue';
import { Screen, Section } from '@/components/Screen';
import { LoadingState, Notice } from '@/components/States';
import { errorMessage } from '@/format';

import { copy, formatRouteDateTime, SOURCE_LABEL } from './copy';
import { RouteMap } from './map/RouteMap';
import { formatElevation, formatRouteDistance, type RoutePoint, type SavedRoute } from './routeModel';
import { RoutePushSection } from './RoutePushSection';
import { RouteStartGuide } from './RouteStartGuide';
import { deleteRoute, loadRoute, renameRoute } from './routeStore';
import { MAX_NAME_LENGTH } from './routeStorage';
import { useRoutePush } from './useRoutePush';

interface LoadedRoute {
  route: SavedRoute;
  points: RoutePoint[];
}

type Phase = 'loading' | 'ready' | 'missing';

/** The name of the route, saved on its own: also what the watch lists it under. */
function NameSection({ route, onRename }: { route: SavedRoute; onRename: (name: string) => Promise<SavedRoute | null> }) {
  const [value, setValue] = useState(route.name);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmed = value.replace(/\s+/g, ' ').trim();
  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const renamed = await onRename(trimmed);
      setMessage(renamed === null ? { ok: false, text: copy.detail.notFound } : { ok: true, text: copy.detail.nameSaved });
    } catch (e) {
      setMessage({ ok: false, text: copy.detail.renameFailed(errorMessage(e)) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={copy.detail.nameTitle} icon="pricetag" tint="workouts">
      <Field
        label={copy.detail.nameLabel}
        value={value}
        onChangeText={(text) => {
          setValue(text);
          setMessage(null);
        }}
        maxLength={MAX_NAME_LENGTH}
        hint={copy.detail.nameHint}
        returnKeyType="done"
      />
      <Button label={copy.detail.saveName} loading={saving} disabled={trimmed === '' || trimmed === route.name} onPress={() => void save()} />
      {message !== null ? <Notice tone={message.ok ? 'info' : 'danger'} icon={message.ok ? 'checkmark-circle' : undefined}>{message.text}</Notice> : null}
    </Section>
  );
}

/** `/routes/[id]`: the route on a map, its numbers, the send to the watch and how to start it there. */
export function RouteDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loaded, setLoaded] = useState<LoadedRoute | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadRoute(id).then(
        (found) => {
          if (cancelled) return;
          setLoaded(found);
          setPhase(found === null ? 'missing' : 'ready');
        },
        (e: unknown) => {
          if (cancelled) return;
          setError(copy.detail.loadFailed(errorMessage(e)));
          setPhase('missing');
        },
      );
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  const replaceRoute = useCallback((route: SavedRoute) => setLoaded((current) => (current ? { ...current, route } : current)), []);

  const rename = useCallback(
    async (name: string) => {
      const route = await renameRoute(id, name);
      if (route !== null) replaceRoute(route);
      return route;
    },
    [id, replaceRoute],
  );

  const push = useRoutePush({ route: loaded?.route ?? null, points: loaded?.points ?? [], rename, onSent: replaceRoute });

  const remove = async () => {
    setConfirmDelete(false);
    try {
      await deleteRoute(id);
      if (router.canGoBack()) router.back();
      else router.replace('/routes');
    } catch (e) {
      setError(copy.library.deleteFailed(errorMessage(e)));
    }
  };

  if (phase === 'loading') {
    return (
      <Screen>
        <LoadingState label={copy.detail.loading} />
      </Screen>
    );
  }
  if (loaded === null) {
    return (
      <Screen>
        <Notice tone="danger">{error ?? copy.detail.notFound}</Notice>
        <Button label={copy.titles.library} icon="list" onPress={() => router.replace('/routes')} />
      </Screen>
    );
  }

  const { route, points } = loaded;
  return (
    <Screen>
      <AppText variant="title" numberOfLines={2}>
        {route.name}
      </AppText>
      <RouteMap points={points} height={280} />

      <Section title={copy.detail.statsTitle} icon="stats-chart" tint="workouts">
        <KeyValue icon="navigate" label={copy.detail.distance} value={formatRouteDistance(route.distanceM)} />
        <KeyValue icon="trending-up" label={copy.detail.ascent} value={formatElevation(route.ascentM)} />
        <KeyValue icon="trending-down" label={copy.detail.descent} value={formatElevation(route.descentM === null ? null : -route.descentM)} />
        <KeyValue icon="git-commit" label={copy.detail.points} value={String(route.pointCount)} />
        <KeyValue icon="analytics" label={copy.detail.altitude} value={route.hasAltitude ? copy.detail.altitudeYes : copy.detail.altitudeNo} />
        <KeyValue icon="document" label={copy.detail.source} value={SOURCE_LABEL[route.source]} />
        <KeyValue icon="calendar" label={copy.detail.created} value={formatRouteDateTime(route.createdAt)} />
        <KeyValue
          icon="watch"
          label={copy.detail.lastSent}
          value={route.lastSentAt === null ? copy.detail.neverSent : formatRouteDateTime(route.lastSentAt)}
        />
        {!route.hasAltitude ? <Notice>{copy.detail.noAltitudeNote}</Notice> : null}
      </Section>

      <RoutePushSection push={push} routeName={route.name} />
      <RouteStartGuide justSent={push.outcome?.kind === 'sent'} />
      <NameSection key={route.name} route={route} onRename={rename} />

      {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={copy.detail.deleteRoute} icon="trash" variant="destructive" onPress={() => setConfirmDelete(true)} />

      <ConfirmDialog
        visible={confirmDelete}
        title={copy.library.deleteTitle}
        message={copy.library.deleteMessage(route.name)}
        confirmLabel={copy.library.deleteConfirm}
        cancelLabel={copy.library.cancel}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}
