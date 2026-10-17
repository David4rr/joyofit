import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Image, Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { Field } from '@/components/Input';
import { Card, Section, useContentPadding, useRefreshControl } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { COMMUNITY_WATCHFACES, type CommunityFace } from '@/features/watchfaces/communityCatalog';
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
        Active on Wrist
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

function WatchThumbnail({ face, active }: { face: CommunityFace; active?: boolean }) {
  const isRound = face.category === 'Round (466x466)';
  const isFit = face.category === 'Fit (336x480)';
  return (
    <View
      style={[
        styles.thumbBase,
        isRound ? styles.thumbRound : isFit ? styles.thumbFit : styles.thumbBand,
        active && styles.thumbActive,
      ]}>
      {face.previewUrl ? (
        <Image
          source={{ uri: face.previewUrl }}
          style={styles.fillImage}
          resizeMode={isRound ? 'contain' : 'cover'}
        />
      ) : (
        <IconChip icon="watch" tint={active ? 'link' : 'neutral'} />
      )}
    </View>
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
  const [previewFace, setPreviewFace] = useState<CommunityFace | null>(null);
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

  const handleInstall = async (url: string, title: string) => {
    setInstallingUrl(url);
    const ok = await installFromUri(url);
    if (!ok) {
      Alert.alert(
        'Pemasangan Ditolak',
        `Jam menolak pemasangan "${title}". Pastikan koneksi Bluetooth stabil dan file cocok dengan Huawei Band 10.`
      );
    }
    setInstallingUrl(null);
  };

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

  const previewModal = (
    <Modal
      visible={previewFace !== null}
      animationType="slide"
      transparent
      onRequestClose={() => setPreviewFace(null)}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
          <View style={styles.modalHeader}>
            <AppText variant="heading" numberOfLines={1} style={{ flex: 1 }}>
              {previewFace?.title}
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => setPreviewFace(null)}
              hitSlop={12}
              style={styles.modalCloseBtn}>
              <Ionicons name="close-circle" size={28} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <View style={styles.modalPreviewArea}>
            <View
              style={[
                styles.modalWatchChassis,
                previewFace?.category === 'Round (466x466)'
                  ? styles.modalChassisRound
                  : previewFace?.category === 'Fit (336x480)'
                    ? styles.modalChassisFit
                    : styles.modalChassisBand,
              ]}>
              {previewFace?.previewUrl ? (
                <Image
                  source={{ uri: previewFace.previewUrl }}
                  style={styles.fillImage}
                  resizeMode={previewFace?.category === 'Round (466x466)' ? 'contain' : 'cover'}
                />
              ) : null}
            </View>
          </View>

          <View style={styles.modalMeta}>
            <View style={styles.modalMetaRow}>
              <AppText variant="caption" muted>
                Author: {previewFace?.author}
              </AppText>
              <AppText variant="caption" muted>
                Format: {previewFace?.sizeLabel}
              </AppText>
            </View>
            <View style={styles.modalMetaRow}>
              <AppText variant="caption" muted>
                Resolution: {previewFace?.width}x{previewFace?.height} px
              </AppText>
              {previewFace && list?.width && list.height ? (
                previewFace.width === list.width && previewFace.height === list.height ? (
                  <View style={[styles.pill, { backgroundColor: colors.muted }]}>
                    <AppText variant="label" color={colors.primary}>
                      Matches Band 10
                    </AppText>
                  </View>
                ) : (
                  <View style={[styles.pill, { backgroundColor: colors.muted }]}>
                      <AppText variant="label" color={colors.destructive}>
                      Different Resolution
                    </AppText>
                  </View>
                )
              ) : null}
            </View>
            <AppText variant="caption" style={{ marginTop: spacing.xs }}>
              {previewFace?.description}
            </AppText>
          </View>

          {previewFace ? (
            <View style={styles.modalActions}>
              {(() => {
                const isModalMatch =
                  list?.width && list.height
                    ? list.width === previewFace.width && list.height === previewFace.height
                    : null;
                const isModalWrong = isModalMatch === false;
                const isModalInstalled = list?.faces?.some(
                  (f) => f.name.toLowerCase().includes(previewFace.title.toLowerCase()) || f.id === previewFace.id
                );
                const isModalInstalling = installing && installingUrl === previewFace.downloadUrl;

                return (
                  <Button
                    label={
                      isModalInstalled
                        ? 'Installed on Watch'
                        : isModalWrong
                          ? `Incompatible Screen (${previewFace.width}x${previewFace.height})`
                          : isModalInstalling
                            ? 'Installing...'
                            : 'Install to Watch'
                    }
                    icon={
                      isModalInstalled
                        ? 'checkmark-circle'
                        : isModalWrong
                          ? 'alert-circle-outline'
                          : 'cloud-download-outline'
                    }
                    variant={isModalWrong || isModalInstalled ? 'secondary' : 'primary'}
                    disabled={!connected || !idle || isModalInstalled || isModalWrong || isModalInstalling}
                    loading={isModalInstalling}
                    onPress={() => {
                      void handleInstall(previewFace.downloadUrl, previewFace.title).then(() => {
                        setPreviewFace(null);
                      });
                    }}
                  />
                );
              })()}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );

  if (tab === 'catalog') {
    return (
      <>
        <FlatList
          style={{ backgroundColor: colors.background }}
          contentContainerStyle={padding}
          data={COMMUNITY_WATCHFACES}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: face }) => {
            const matchesScreen =
              list?.width && list.height ? list.width === face.width && list.height === face.height : null;
            const isWrongScreen = matchesScreen === false;
            const isInstalled = list?.faces?.some(
              (f) => f.name.toLowerCase().includes(face.title.toLowerCase()) || f.id === face.id
            );
            const isCurrentInstalling = installing && installingUrl === face.downloadUrl;

            return (
              <Card>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Preview ${face.title}`}
                  onPress={() => setPreviewFace(face)}
                  style={styles.catalogCardRow}>
                  <WatchThumbnail face={face} />
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
                      ) : isWrongScreen ? (
                        <View style={[styles.pill, { backgroundColor: colors.muted }]}>
                          <AppText variant="label" color={colors.destructive}>
                            Different size
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
                  <Ionicons name="eye-outline" size={20} color={colors.mutedForeground} />
                </Pressable>
                <AppText variant="caption">{face.description}</AppText>
                <View style={styles.actions}>
                  <Button
                    label={
                      isInstalled
                        ? 'Installed'
                        : isWrongScreen
                          ? `Incompatible (${face.width}x${face.height})`
                          : isCurrentInstalling
                            ? 'Installing...'
                            : '1-Click Install'
                    }
                    icon={
                      isInstalled
                        ? 'checkmark-circle'
                        : isWrongScreen
                          ? 'alert-circle-outline'
                          : 'cloud-download-outline'
                    }
                    variant={isWrongScreen || isInstalled ? 'secondary' : 'primary'}
                    disabled={!connected || !idle || isInstalled || isCurrentInstalling}
                    loading={isCurrentInstalling}
                    onPress={() => {
                      if (isWrongScreen) {
                        Alert.alert(
                          'Ukuran Layar Tidak Cocok',
                          `Watch face ini dibuat khusus untuk layar ${face.width}x${face.height} px.\n\nHuawei Band 10 Anda berlayar ${list?.width}x${list?.height} px, sehingga jam akan menolak file ini agar tampilan tidak rusak.`
                        );
                        return;
                      }
                      void handleInstall(face.downloadUrl, face.title);
                    }}
                  />
                  <Button label="Preview" icon="eye-outline" onPress={() => setPreviewFace(face)} />
                </View>
              </Card>
            );
          }}
        />
        {previewModal}
      </>
    );
  }

  return (
    <>
      <FlatList
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={padding}
        data={list?.faces ?? []}
        keyExtractor={(face) => face.id}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={refreshControl}
        initialNumToRender={8}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        renderItem={({ item: face }) => {
          const working = typeof busy === 'object' && busy !== null && busy.id === face.id;
          const action = typeof busy === 'object' && busy !== null ? busy.action : null;
          const catalogMatch = COMMUNITY_WATCHFACES.find(
            (c) =>
              c.id === face.id ||
              face.name.toLowerCase().includes(c.title.toLowerCase()) ||
              face.name.toLowerCase().includes(c.id) ||
              (c.id === 'nike9_sport_band' && face.name.toLowerCase().includes('nike'))
          );

          return (
            <Card style={face.active ? [styles.activeCard, { borderColor: colors.primary }] : undefined}>
              <View style={styles.faceHeader}>
                {catalogMatch ? (
                  <Pressable onPress={() => setPreviewFace(catalogMatch)}>
                    <WatchThumbnail face={catalogMatch} active={face.active} />
                  </Pressable>
                ) : (
                  <View style={[styles.thumbBase, styles.thumbBand, face.active && styles.thumbActive]}>
                    <IconChip icon={face.photo ? 'image' : 'watch'} tint={face.active ? 'link' : 'neutral'} />
                  </View>
                )}
                <View style={styles.faceText}>
                  <View style={styles.titleLine}>
                    <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                      {face.name}
                    </AppText>
                    {face.active ? <ActivePill /> : null}
                  </View>
                  <AppText variant="caption" muted>
                    {face.id} v{face.version}
                    {face.factory ? ' · preinstalled' : ''}
                    {face.tryout ? ' · trial' : ''}
                    {face.video ? ' · video' : ''}
                    {face.photo ? ' · photo' : ''}
                  </AppText>
                </View>
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
                    onPress={() =>
                      router.push({ pathname: '/watch/face-edit', params: { id: face.id, name: face.name } })
                    }
                  />
                ) : null}
                {catalogMatch ? (
                  <Button label="Preview" icon="eye-outline" onPress={() => setPreviewFace(catalogMatch)} />
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
      {previewModal}
    </>
  );
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
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  activeCard: { borderWidth: 1.5 },
  thumbBase: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  thumbBand: {
    width: 52,
    height: 80,
    borderRadius: 14,
    backgroundColor: '#050505',
  },
  thumbRound: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#ffffff',
  },
  thumbFit: {
    width: 56,
    height: 76,
    borderRadius: 12,
    backgroundColor: '#050505',
  },
  thumbActive: {
    borderColor: '#3b82f6',
    borderWidth: 2,
  },
  fillImage: {
    width: '100%',
    height: '100%',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: spacing.xl,
    gap: spacing.lg,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalPreviewArea: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  modalWatchChassis: {
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  modalChassisBand: {
    width: 130,
    height: 246,
    borderRadius: 28,
    backgroundColor: '#050505',
  },
  modalChassisRound: {
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: '#ffffff',
  },
  modalChassisFit: {
    width: 150,
    height: 214,
    borderRadius: 24,
    backgroundColor: '#050505',
  },
  modalMeta: {
    gap: spacing.xs,
  },
  modalMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalActions: {
    marginTop: spacing.xs,
  },
});
