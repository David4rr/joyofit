import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Card, Divider, Screen, Section } from '@/components/Screen';
import { PressableScale } from '@/components/PressableScale';
import { LoadingState, Notice } from '@/components/States';
import { IconAction } from '@/features/courses/IconAction';
import { errorMessage } from '@/format';
import { radius, spacing, useTheme } from '@/theme';

import { copy, SOURCE_LABEL } from './copy';
import { NumberedSteps } from './NumberedSteps';
import { pickRouteFile } from './readRouteFile';
import { formatElevation, formatRouteDistance, type SavedRoute } from './routeModel';
import { RouteThumbnail } from './RouteThumbnail';
import { deleteRoute, listRouteCards, type RouteCard } from './routeStore';
import { WorkoutPickerSheet } from './WorkoutPickerSheet';

function SourceTag({ source }: { source: SavedRoute['source'] }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.tag, { backgroundColor: colors.workoutsSoft }]}>
      <AppText variant="label" color={colors.workoutsText}>
        {SOURCE_LABEL[source]}
      </AppText>
    </View>
  );
}

function RouteRow({ card, onOpen, onDelete }: { card: RouteCard; onOpen: () => void; onDelete: () => void }) {
  const { route } = card;
  const elevation =
    route.ascentM !== null && route.descentM !== null ? ` \u00B7 ${formatElevation(route.ascentM)} \u00B7 ${formatElevation(-route.descentM)}` : '';
  return (
    <Card style={styles.row}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={copy.library.openRoute(route.name)}
        onPress={onOpen}
        scaleTo={0.985}
        style={styles.main}>
        <RouteThumbnail points={card.thumb} />
        <View style={styles.text}>
          <AppText variant="bodyStrong" numberOfLines={2}>
            {route.name}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {`${formatRouteDistance(route.distanceM)}${elevation}`}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {route.lastSentAt === null ? copy.library.neverSent : copy.library.lastSent(route.lastSentAt)}
          </AppText>
          <SourceTag source={route.source} />
        </View>
      </PressableScale>
      <IconAction icon="trash-outline" label={copy.library.deleteRoute(route.name)} danger onPress={onDelete} />
    </Card>
  );
}

/** `/routes`: the saved routes, and the ways to add one: a GPX or TCX file, a drawing on the map, a past workout. */
export function RouteLibraryScreen() {
  const router = useRouter();
  const [cards, setCards] = useState<RouteCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SavedRoute | null>(null);

  const load = useCallback(async () => {
    try {
      setCards(await listRouteCards());
      setError(null);
    } catch (e) {
      setError(copy.library.loadFailed(errorMessage(e)));
      setCards((current) => current ?? []);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const open = (id: string) => router.push({ pathname: '/routes/[id]', params: { id } });

  const pickFile = async () => {
    try {
      const picked = await pickRouteFile();
      if (picked) router.push({ pathname: '/routes/import', params: { uri: picked.uri, name: picked.name } });
    } catch (e) {
      setError(copy.library.pickFailed(errorMessage(e)));
    }
  };

  const confirmDelete = async () => {
    const route = pendingDelete;
    setPendingDelete(null);
    if (route === null) return;
    try {
      await deleteRoute(route.id);
      await load();
    } catch (e) {
      setError(copy.library.deleteFailed(errorMessage(e)));
    }
  };

  return (
    <Screen
      refresh={{
        refreshing,
        onRefresh: () => {
          setRefreshing(true);
          void load().finally(() => setRefreshing(false));
        },
      }}>
      <Section title={copy.library.addTitle} icon="add-circle" tint="workouts">
        <Button label={copy.library.importFile} icon="document-attach" variant="primary" onPress={() => void pickFile()} />
        <Button label={copy.library.drawOnMap} icon="create" onPress={() => router.push('/routes/draw')} />
        <Button label={copy.library.fromWorkout} icon="fitness" onPress={() => setPickerOpen(true)} />
      </Section>

      {error !== null ? <Notice tone="danger">{error}</Notice> : null}

      {cards === null ? <LoadingState label={copy.library.loading} /> : null}

      {cards !== null && cards.length === 0 ? (
        <Section title={copy.library.emptyTitle} icon="trail-sign" tint="workouts">
          <AppText variant="caption" muted>
            {copy.library.emptyDescription}
          </AppText>
          <Divider />
          <NumberedSteps steps={copy.library.ways} />
        </Section>
      ) : null}

      {cards !== null && cards.length > 0 ? (
        <View style={styles.list}>
          <AppText variant="heading" accessibilityRole="header">
            {copy.library.listTitle}
          </AppText>
          {cards.map((card) => (
            <RouteRow key={card.route.id} card={card} onOpen={() => open(card.route.id)} onDelete={() => setPendingDelete(card.route)} />
          ))}
        </View>
      ) : null}

      <WorkoutPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSaved={(route) => {
          setPickerOpen(false);
          open(route.id);
        }}
      />
      <ConfirmDialog
        visible={pendingDelete !== null}
        title={copy.library.deleteTitle}
        message={pendingDelete ? copy.library.deleteMessage(pendingDelete.name) : ''}
        confirmLabel={copy.library.deleteConfirm}
        cancelLabel={copy.library.cancel}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, gap: 2 },
  tag: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
});
