import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { IconChip } from '@/components/IconChip';
import { Card, Section, useContentPadding, useRefreshControl } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { useWatchfaces } from '@/features/watchfaces/useWatchfaces';
import { formatDateTime } from '@/format';
import { fmtInt } from '@/i18n';
import { radius, spacing, tintColors, useColors } from '@/theme';
import type { WatchfaceInfo } from '@/wear';

const SKELETON_ROWS = [0, 1, 2];

/** "Active" badge on the face that is on the watch's screen now. */
function ActivePill() {
  const { t } = useTranslation('watch');
  const colors = useColors();
  const link = tintColors(colors, 'link');
  return (
    <View style={[styles.pill, { backgroundColor: link.soft }]}>
      <AppText variant="label" color={link.text}>
        {t('faces.active')}
      </AppText>
    </View>
  );
}

/** Stand-in for a face card while the list is being read. */
function FaceSkeleton() {
  return (
    <Card>
      <View style={styles.faceHeader}>
        <Skeleton width={40} height={40} radius={20} />
        <View style={styles.faceText}>
          <Skeleton width="55%" height={16} />
          <Skeleton width="35%" height={12} />
        </View>
      </View>
      <View style={styles.actions}>
        <Skeleton width={120} height={48} radius={radius.pill} />
        <Skeleton width={96} height={48} radius={radius.pill} />
      </View>
    </Card>
  );
}

/** Lists, activates, deletes and installs watch faces on the connected watch. */
export function WatchfacesScreen() {
  const router = useRouter();
  const { t } = useTranslation(['watch', 'common']);
  const colors = useColors();
  const padding = useContentPadding(false);
  const { connected, list, busy, error, notice, progress, refresh, setActive, remove, install } = useWatchfaces();
  const refreshControl = useRefreshControl({
    refreshing: busy === 'list',
    onRefresh: () => void refresh(),
    enabled: connected,
  });
  const idle = busy === null;
  const installing = busy === 'install';
  const percent =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.bytes / progress.total) * 100)) : 0;

  const confirmDelete = (face: WatchfaceInfo) =>
    Alert.alert(t('watch:faces.deleteTitle'), t('watch:faces.deleteMessage', { name: face.name }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('common:actions.delete'), style: 'destructive', onPress: () => void remove(face.id) },
    ]);

  const listMeta = list
    ? [
        list.width && list.height ? t('watch:faces.screenSize', { width: list.width, height: list.height }) : null,
        list.maxVersion ? t('watch:faces.maxVersion', { version: list.maxVersion }) : null,
        t('watch:faces.readAt', { time: formatDateTime(list.updatedAt / 1000) }),
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  const header = (
    <View style={styles.header}>
      <Section title={t('watch:faces.installTitle')} icon="cloud-upload">
        <Details>
          {list?.width && list.height
            ? t('watch:faces.installAboutSized', { width: list.width, height: list.height })
            : t('watch:faces.installAbout')}
        </Details>
        {!connected ? (
          <Notice icon="bluetooth" action={{ label: t('watch:openWatch'), onPress: () => router.navigate('/watch') }}>
            {t('watch:faces.connect')}
          </Notice>
        ) : null}
        <Button
          label={t('watch:faces.install')}
          variant="primary"
          icon="document"
          disabled={!connected || !idle}
          loading={installing}
          onPress={() => void install()}
        />
        {installing && progress ? (
          <View style={styles.progress}>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: percent }}
              style={[styles.track, { backgroundColor: colors.muted }]}>
              <View style={[styles.bar, { backgroundColor: colors.primary, width: `${percent}%` }]} />
            </View>
            <AppText variant="caption" muted>
              {progress.total > 0
                ? t('watch:faces.progress', { percent: fmtInt(percent), bytes: fmtInt(progress.bytes), total: fmtInt(progress.total) })
                : t('watch:faces.waiting')}
            </AppText>
          </View>
        ) : null}
        {notice ? (
          <Notice icon="checkmark-circle">{notice}</Notice>
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </Section>

      <View style={styles.listTitle}>
        <View style={styles.listTitleRow} accessibilityRole="header">
          <IconChip icon="watch" size="sm" />
          <AppText variant="heading">{t('watch:faces.onWatch')}</AppText>
        </View>
        {listMeta ? (
          <AppText variant="caption" muted>
            {listMeta}
          </AppText>
        ) : null}
      </View>
    </View>
  );

  const empty = (() => {
    if (list === null && !connected) {
      return (
        <Card>
          <EmptyState
            icon="watch"
            title={t('watch:faces.notConnected')}
            description={t('watch:faces.notConnectedHint')}
          />
        </Card>
      );
    }
    if (busy === 'list' && list === null) {
      return (
        <View style={styles.skeletons}>
          {SKELETON_ROWS.map((row) => (
            <FaceSkeleton key={row} />
          ))}
        </View>
      );
    }
    return (
      <Card>
        {list === null ? (
          <EmptyState
            icon="watch"
            title={t('watch:faces.notRead')}
            description={t('watch:faces.notReadHint')}
            action={{ label: t('watch:faces.read'), icon: 'refresh', onPress: () => void refresh() }}
          />
        ) : (
          <EmptyState
            icon="watch"
            title={t('watch:faces.none')}
            description={t('watch:faces.noneHint')}
          />
        )}
      </Card>
    );
  })();

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={padding}
      data={list?.faces ?? []}
      keyExtractor={(face) => face.id}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ItemSeparatorComponent={Separator}
      refreshControl={refreshControl}
      initialNumToRender={8}
      windowSize={7}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      renderItem={({ item: face }) => {
        const working = typeof busy === 'object' && busy !== null && busy.id === face.id;
        const action = typeof busy === 'object' && busy !== null ? busy.action : null;
        return (
          <Card>
            <View style={styles.faceHeader}>
              <IconChip icon="watch" tint={face.active ? 'link' : 'neutral'} />
              <View style={styles.faceText}>
                <AppText variant="bodyStrong" numberOfLines={2}>
                  {face.name}
                </AppText>
                <AppText variant="caption" muted>
                  {[
                    `${face.id} v${face.version}`,
                    face.factory ? t('watch:faces.tagFactory') : null,
                    face.tryout ? t('watch:faces.tagTrial') : null,
                    face.video ? t('watch:faces.tagVideo') : null,
                    face.photo ? t('watch:faces.tagPhoto') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </AppText>
              </View>
              {face.active ? <ActivePill /> : null}
            </View>
            <View style={styles.actions}>
              <Button
                label={t('watch:faces.setActive')}
                icon="checkmark-circle"
                disabled={!connected || !idle || face.active}
                loading={working && action === 'activate'}
                onPress={() => void setActive(face.id)}
              />
              {face.editable ? (
                <Button
                  label={t('watch:faces.customize')}
                  icon="color-palette"
                  disabled={!connected || !idle}
                  onPress={() => router.push({ pathname: '/watch/face-edit', params: { id: face.id, name: face.name } })}
                />
              ) : null}
              <Button
                label={t('common:actions.delete')}
                icon="trash"
                variant="destructive"
                disabled={!connected || !idle || face.factory}
                loading={working && action === 'delete'}
                onPress={() => confirmDelete(face)}
              />
            </View>
          </Card>
        );
      }}
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  header: { gap: spacing.xl, marginBottom: spacing.md },
  listTitle: { gap: spacing.xs },
  listTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  separator: { height: spacing.md },
  skeletons: { gap: spacing.md },
  faceHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  faceText: { flex: 1, gap: 2 },
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  progress: { gap: spacing.sm },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  bar: { height: 8, borderRadius: radius.pill },
});
