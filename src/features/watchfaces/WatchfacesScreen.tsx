import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Image, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { Field } from '@/components/Input';
import { Card, Section, useContentPadding, useRefreshControl } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { COMMUNITY_WATCHFACES } from '@/features/watchfaces/communityCatalog';
import { useWatchfaces } from '@/features/watchfaces/useWatchfaces';
import { formatDateTime } from '@/format';
import { radius, spacing, tintColors, useColors } from '@/theme';
import type { WatchfaceInfo } from '@/wear';

const TAB_OPTIONS = [
  { value: 'installed', label: 'On watch' },
  { value: 'catalog', label: 'Free catalog' },
] as const;

type TabMode = (typeof TAB_OPTIONS)[number]['value'];
const SKELETON_ROWS = [0, 1, 2];

/** "Active" badge on the face that is on the watch's screen now. */
function ActivePill() {
  const colors = useColors();
  const link = tintColors(colors, 'link');
  return (
    <View style={[styles.pill, { backgroundColor: link.soft }]}>
      <AppText variant="label" color={link.text}>
        Active
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
  const colors = useColors();
  const padding = useContentPadding(false);
  const { connected, list, busy, error, notice, progress, refresh, setActive, remove, install, installFromUri } =
    useWatchfaces();
  const [tab, setTab] = useState<TabMode>('installed');
  const [customUrl, setCustomUrl] = useState('');
  const [installingUrl, setInstallingUrl] = useState<string | null>(null);
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
    Alert.alert('Delete watch face', `Delete "${face.name}" from the watch?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void remove(face.id) },
    ]);

  const listMeta = list
    ? [
        list.width && list.height ? `Screen ${list.width} x ${list.height} px` : null,
        list.maxVersion ? `Newest face format ${list.maxVersion}` : null,
        `Read ${formatDateTime(list.updatedAt / 1000)}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  const header = (
    <View style={styles.header}>
      <Segmented options={TAB_OPTIONS} value={tab} onChange={setTab} />

      {tab === 'installed' ? (
        <Section title="Install from file" icon="cloud-upload">
          <AppText variant="caption">
            Make faces in Huawei Theme Studio Pro and export them as .hwt files.{' '}
            {list?.width && list.height
              ? `This watch's screen is ${list.width} x ${list.height} px.`
              : "Make them for your watch's screen size."}{' '}
            A face made for another screen is refused before it is sent.
          </AppText>
          {!connected ? (
            <Notice icon="bluetooth" action={{ label: 'Open Watch', onPress: () => router.navigate('/watch') }}>
              Connect your watch to manage its faces.
            </Notice>
          ) : null}
          <Button
            label="Install from .hwt file"
            variant="primary"
            icon="document"
            disabled={!connected || !idle}
            loading={installing && installingUrl === null}
            onPress={() => void install()}
          />
        </Section>
      ) : (
        <Section title="Community Watch Faces" icon="globe-outline">
          <AppText variant="caption">
            Browse free community watch faces. Tap Install to download and transfer to your watch in 1 click.
            {list?.width && list.height ? ` Connected screen: ${list.width} x ${list.height} px.` : ''}
          </AppText>
          {!connected ? (
            <Notice icon="bluetooth" action={{ label: 'Open Watch', onPress: () => router.navigate('/watch') }}>
              Connect your watch to install faces directly.
            </Notice>
          ) : null}
          <Field
            label="Install from custom URL"
            hint="Direct link to any public .hwt file"
            placeholder="https://example.com/watchface.hwt"
            value={customUrl}
            onChangeText={setCustomUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button
            label="Download & Install from URL"
            icon="cloud-download-outline"
            variant="primary"
            disabled={!connected || !idle || !customUrl.trim().startsWith('http')}
            loading={installing && installingUrl === customUrl}
            onPress={() => {
              const url = customUrl.trim();
              setInstallingUrl(url);
              void installFromUri(url).finally(() => setInstallingUrl(null));
            }}
          />
        </Section>
      )}

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
              ? `${percent}% (${progress.bytes.toLocaleString()} of ${progress.total.toLocaleString()} bytes)`
              : 'Transferring to watch...'}
          </AppText>
        </View>
      ) : null}
      {notice ? <Notice icon="checkmark-circle">{notice}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <View style={styles.listTitle}>
        <View style={styles.listTitleRow} accessibilityRole="header">
          <IconChip icon={tab === 'installed' ? 'watch' : 'grid'} size="sm" />
          <AppText variant="heading">{tab === 'installed' ? 'On the watch' : 'Curated faces'}</AppText>
        </View>
        {tab === 'installed' && listMeta ? (
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
            title="Watch not connected"
            description="The faces on your watch appear here once it is connected."
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
            title="Faces not read yet"
            description="Read the list from your watch to see its faces."
            action={{ label: 'Read from the watch', icon: 'refresh', onPress: () => void refresh() }}
          />
        ) : (
          <EmptyState
            icon="watch"
            title="No watch faces"
            description="The watch lists no faces. Install one from a file above."
          />
        )}
      </Card>
    );
  })();

  if (tab === 'catalog') {
    return (
      <FlatList
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={padding}
        data={COMMUNITY_WATCHFACES}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        ItemSeparatorComponent={Separator}
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={false}
        renderItem={({ item: face }) => {
          const matchesScreen =
            list?.width && list.height ? list.width === face.width && list.height === face.height : null;
          const isCurrentInstalling = installing && installingUrl === face.downloadUrl;
          return (
            <Card>
              <View style={styles.catalogCardRow}>
                {face.previewUrl ? (
                  <View style={[styles.previewFrame, { backgroundColor: colors.muted }]}>
                    <Image source={{ uri: face.previewUrl }} style={styles.catalogThumbnail} resizeMode="contain" />
                  </View>
                ) : (
                  <IconChip icon="watch" tint={matchesScreen ? 'link' : 'neutral'} />
                )}
                <View style={styles.faceText}>
                  <View style={styles.titleLine}>
                    <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                      {face.title}
                    </AppText>
                    {matchesScreen ? (
                      <View style={[styles.pill, { backgroundColor: colors.muted }]}>
                        <AppText variant="label" color={colors.primary}>
                          Matches
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                  <AppText variant="caption" muted>
                    by {face.author}
                  </AppText>
                  <AppText variant="caption" muted>
                    {face.width}x{face.height} px · {face.sizeLabel}
                  </AppText>
                </View>
              </View>
              <AppText variant="caption">{face.description}</AppText>
              <View style={styles.actions}>
                <Button
                  label={isCurrentInstalling ? 'Installing...' : '1-Click Install'}
                  icon="cloud-download-outline"
                  variant="primary"
                  disabled={!connected || !idle}
                  loading={isCurrentInstalling}
                  onPress={() => {
                    setInstallingUrl(face.downloadUrl);
                    void installFromUri(face.downloadUrl).finally(() => setInstallingUrl(null));
                  }}
                />
              </View>
            </Card>
          );
        }}
      />
    );
  }

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
                  {face.id} v{face.version}
                  {face.factory ? ' · preinstalled' : ''}
                  {face.tryout ? ' · trial' : ''}
                  {face.video ? ' · video' : ''}
                  {face.photo ? ' · photo' : ''}
                </AppText>
              </View>
              {face.active ? <ActivePill /> : null}
            </View>
            <View style={styles.actions}>
              <Button
                label="Set active"
                icon="checkmark-circle"
                disabled={!connected || !idle || face.active}
                loading={working && action === 'activate'}
                onPress={() => void setActive(face.id)}
              />
              {face.editable ? (
                <Button
                  label="Customize"
                  icon="color-palette"
                  disabled={!connected || !idle}
                  onPress={() => router.push({ pathname: '/watch/face-edit', params: { id: face.id, name: face.name } })}
                />
              ) : null}
              <Button
                label="Delete"
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
  catalogCardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  previewFrame: {
    width: 64,
    height: 84,
    borderRadius: radius.card / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  catalogThumbnail: { width: '100%', height: '100%', borderRadius: 8 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
