import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { Card, Section, useContentPadding, useRefreshControl } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { EmptyState, Notice } from '@/components/States';
import { InstalledFaceCard } from '@/features/watchfaces/InstalledFaceCard';
import { LibraryFaceCard } from '@/features/watchfaces/LibraryFaceCard';
import { ThemedDialog, type CustomDialogState } from '@/features/watchfaces/ThemedDialog';
import { WatchfacePreviewModal } from '@/features/watchfaces/WatchfacePreviewModal';
import { WatchStorageCard } from '@/features/watchfaces/WatchStorageCard';
import { FaceSkeleton } from '@/features/watchfaces/WatchThumbnail';
import { resolveCategory, type WatchfaceItem } from '@/features/watchfaces/watchfaceModel';
import { useWatchfaceLibrary, type DownloadedFace } from '@/features/watchfaces/useWatchfaceLibrary';
import { useWatchfaces } from '@/features/watchfaces/useWatchfaces';
import { radius, spacing, useColors } from '@/theme';
import { HuaweiWear, type WatchfaceInfo } from '@/wear';

type TabMode = 'installed' | 'library';

const TAB_OPTIONS = [
  { value: 'installed', label: 'On watch' },
  { value: 'library', label: 'My watch' },
] as const;

const SKELETON_ROWS = [0, 1, 2];

/** Matches an installed watch hardware face to a downloaded library entry. */
export function findFaceMatch(
  face: WatchfaceInfo,
  library: readonly DownloadedFace[],
): WatchfaceItem | undefined {
  const normFaceName = face.name.toLowerCase().trim();
  return library.find(
    (l) =>
      l.hardwareId === face.id ||
      l.id === face.id ||
      l.title.toLowerCase().trim() === normFaceName ||
      normFaceName.includes(l.title.toLowerCase().trim()) ||
      l.title.toLowerCase().trim().includes(normFaceName),
  );
}

/** Finds whether a library/catalog face is installed on the active watch. */
export function findInstalledFace(
  face: { id: string; title: string; hardwareId?: string },
  faces: readonly WatchfaceInfo[] | undefined,
): WatchfaceInfo | undefined {
  if (!faces || faces.length === 0) return undefined;
  const targetTitle = face.title.toLowerCase().trim();
  return faces.find(
    (f) =>
      (face.hardwareId && f.id === face.hardwareId) ||
      f.id === face.id ||
      f.name.toLowerCase().trim() === targetTitle ||
      targetTitle.includes(f.name.toLowerCase().trim()) ||
      f.name.toLowerCase().trim().includes(targetTitle),
  );
}

/** Lists, activates, deletes and installs watch faces on the connected watch. */
export function WatchfacesScreen() {
  const router = useRouter();
  const colors = useColors();
  const padding = useContentPadding(false);
  const { connected, list, busy, error, notice, progress, refresh, setActive, remove, installFromUri } =
    useWatchfaces();
  const { library, saveToLibrary, removeFromLibrary } = useWatchfaceLibrary();
  const [tab, setTab] = useState<TabMode>('installed');
  const [installingUrl, setInstallingUrl] = useState<string | null>(null);
  const [previewFace, setPreviewFace] = useState<WatchfaceItem | null>(null);
  const [dialog, setDialog] = useState<CustomDialogState | null>(null);

  const refreshControl = useRefreshControl({
    refreshing: busy === 'list',
    onRefresh: () => void refresh(),
    enabled: connected,
  });
  const idle = busy === null;
  const installing = busy === 'install';
  const percent =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.bytes / progress.total) * 100)) : 0;

  const promptInstallAfterSave = (savedFace: DownloadedFace) => {
    const targetW = list?.width ?? 194;
    const targetH = list?.height ?? 368;
    const isCompatible = savedFace.width === targetW && savedFace.height === targetH;

    if (!isCompatible) {
      setDialog({
        visible: true,
        icon: 'alert-circle-outline',
        title: 'Saved to My Watch',
        message: `"${savedFace.title}" has been saved to your My watch collection.\n\nNote: This watch face (${savedFace.width}×${savedFace.height}) does not match your watch screen resolution (${targetW}×${targetH}) and cannot be installed to this watch.`,
        confirmLabel: 'OK',
        confirmVariant: 'primary',
        onConfirm: () => setDialog(null),
      });
      return;
    }

    setDialog({
      visible: true,
      icon: 'checkmark-circle-outline',
      title: 'Saved to My Watch',
      message: `"${savedFace.title}" has been saved to your My watch collection.\n\nWould you like to install it to your watch right now?`,
      confirmLabel: 'Install to Watch Now',
      confirmVariant: 'primary',
      cancelLabel: 'Keep in My Watch',
      onConfirm: () => void handleInstall(savedFace),
    });
  };

  const handleInstall = async (face: WatchfaceItem) => {
    if (!face.downloadUrl) return;
    setInstallingUrl(face.downloadUrl);
    const outcome = await installFromUri(face.downloadUrl);
    if (outcome) {
      saveToLibrary({
        id: face.id,
        title: face.title,
        author: face.author,
        width: face.width,
        height: face.height,
        sizeLabel: face.sizeLabel,
        description: face.description,
        downloadUrl: face.downloadUrl,
        previewUrl: face.previewUrl,
        category: face.category,
      });
    } else {
      setDialog({
        visible: true,
        icon: 'close-circle-outline',
        title: 'Install Rejected',
        message: `The watch rejected "${face.title}". The watch memory may be full, or the file is incompatible with your screen size.`,
        confirmLabel: 'OK',
        confirmVariant: 'primary',
        onConfirm: () => setDialog(null),
      });
    }
    setInstallingUrl(null);
  };

  const confirmDeleteFromWatch = (face: WatchfaceInfo) => {
    setDialog({
      visible: true,
      icon: 'trash-outline',
      title: 'Delete from Watch',
      message: `Permanently delete "${face.name}" from your watch hardware? Pre-installed factory faces cannot be deleted.`,
      confirmLabel: 'Delete',
      confirmVariant: 'destructive',
      cancelLabel: 'Cancel',
      onConfirm: () => void remove(face.id),
    });
  };

  const confirmDeleteFromLibrary = (face: DownloadedFace) => {
    const isOnWatch = Boolean(findInstalledFace(face, list?.faces));
    setDialog({
      visible: true,
      icon: 'trash-outline',
      title: 'Delete from Storage',
      message: isOnWatch
        ? `Delete "${face.title}" from your phone storage?\n\nIt is currently installed on your watch and will stay on the watch until uninstalled.`
        : `Permanently delete "${face.title}" from your phone storage? To reinstall it in the future, you will need to re-import it.`,
      confirmLabel: 'Delete from Phone',
      confirmVariant: 'destructive',
      cancelLabel: 'Cancel',
      onConfirm: () => removeFromLibrary(face.id),
    });
  };

  const handleImportToMyWatch = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (picked.canceled || picked.assets.length === 0) return;
      const asset = picked.assets[0];

      const isHwt = asset.name.toLowerCase().endsWith('.hwt');
      if (!isHwt) {
        const isZip = asset.name.toLowerCase().endsWith('.zip');
        setDialog({
          visible: true,
          icon: 'alert-circle-outline',
          title: 'Invalid File Extension',
          message: isZip
            ? `"${asset.name}" is a .zip archive, not a .hwt file.\n\nMany watch faces are distributed inside a .zip file. Please extract the .zip using your phone's file manager and import the .hwt file found inside.`
            : `"${asset.name}" does not have a .hwt extension. Please select a valid Huawei watch face (.hwt) file.`,
          confirmLabel: 'OK',
          confirmVariant: 'primary',
          onConfirm: () => setDialog(null),
        });
        return;
      }

      let parsed;
      try {
        parsed = await HuaweiWear.parseWatchfacePackage(asset.uri);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Invalid watch face package';
        setDialog({
          visible: true,
          icon: 'close-circle-outline',
          title: 'Invalid Watch Face Package',
          message: `Could not parse "${asset.name}":\n\n${msg}`,
          confirmLabel: 'OK',
          confirmVariant: 'primary',
          onConfirm: () => setDialog(null),
        });
        return;
      }

      const title = parsed.title || asset.name.replace(/\.hwt$/i, '');
      const author = parsed.author || 'Custom Import';
      const width = parsed.width || list?.width || 194;
      const height = parsed.height || list?.height || 368;
      const previewUrl = parsed.previewUri || undefined;
      const downloadPath = parsed.localUri || asset.uri;
      const description =
        parsed.description && parsed.description.trim() !== '{}' && parsed.description.trim() !== '[]'
          ? parsed.description
          : 'No description provided by creator.';
      const sizeLabel = asset.size ? `${Math.round(asset.size / 1024)} KB` : 'Custom size';

      const newFace: DownloadedFace = {
        id: `local_${Date.now()}`,
        title,
        author,
        width,
        height,
        sizeLabel,
        description,
        downloadUrl: downloadPath,
        previewUrl,
        category: resolveCategory(width),
        savedAt: Date.now(),
      };

      saveToLibrary(newFace);
      promptInstallAfterSave(newFace);
    } catch {
      // ignore picker cancel
    }
  };

  const listMeta = list
    ? [
        list.width && list.height ? `Screen ${list.width} x ${list.height} px` : null,
        list.faces ? `${list.faces.length} on watch` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  const header = (
    <View style={styles.header}>
      <Segmented options={TAB_OPTIONS} value={tab} onChange={setTab} />

      {tab === 'installed' ? (
        !connected ? (
          <Notice icon="bluetooth" action={{ label: 'Open Watch', onPress: () => router.navigate('/watch') }}>
            Connect your watch to manage its faces.
          </Notice>
        ) : null
      ) : (
        <Section title="Personal library" icon="folder-open-outline">
          <AppText variant="caption">
            Watch faces stored on your phone. Keep your favorites here and swap them onto your watch anytime.
          </AppText>
          <View style={styles.actionRow}>
            <Button
              label="Import .hwt file"
              variant="primary"
              icon="document-attach-outline"
              style={{ flex: 1 }}
              onPress={() => void handleImportToMyWatch()}
            />
          </View>
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
              ? `Transferring: ${percent}% (${progress.bytes.toLocaleString()} of ${progress.total.toLocaleString()} bytes)`
              : 'Transferring to watch...'}
          </AppText>
        </View>
      ) : null}
      {notice ? <Notice icon="checkmark-circle">{notice}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <View style={styles.listTitle}>
        <View style={styles.listTitleRow} accessibilityRole="header">
          <IconChip icon={tab === 'installed' ? 'watch' : 'folder'} size="sm" />
          <AppText variant="heading">
            {tab === 'installed' ? 'On the watch' : 'My watch collection'}
          </AppText>
        </View>
        {tab === 'installed' && listMeta ? (
          <AppText variant="caption" muted>
            {listMeta}
          </AppText>
        ) : null}
      </View>
      {tab === 'installed' && list ? <WatchStorageCard list={list} library={library} /> : null}
    </View>
  );

  const matchedPreview = previewFace ? findInstalledFace(previewFace, list?.faces) : undefined;

  const installedEmpty = (() => {
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
            description="The watch lists no faces. Install one from your My watch library."
          />
        )}
      </Card>
    );
  })();

  const libraryEmpty = (
    <Card>
      <EmptyState
        icon="folder"
        title="No watch faces saved"
        description="Import a .hwt file from your phone storage to build your personal offline collection."
        action={{
          label: 'Import .hwt file',
          icon: 'document-attach-outline',
          onPress: () => void handleImportToMyWatch(),
        }}
      />
    </Card>
  );

  return (
    <>
      {tab === 'installed' ? (
        <FlatList
          style={{ backgroundColor: colors.background }}
          contentContainerStyle={padding}
          data={list?.faces ?? []}
          keyExtractor={(face) => face.id}
          ListHeaderComponent={header}
          ListEmptyComponent={installedEmpty}
          ItemSeparatorComponent={Separator}
          refreshControl={refreshControl}
          initialNumToRender={8}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          renderItem={({ item: face }) => (
            <InstalledFaceCard
              face={face}
              match={findFaceMatch(face, library)}
              screenWidth={list?.width}
              screenHeight={list?.height}
              busy={busy}
              connected={connected}
              idle={idle}
              onPreview={setPreviewFace}
              onSetActive={(id) => void setActive(id)}
              onCustomize={(id, name) =>
                router.push({ pathname: '/watch/face-edit', params: { id, name } })
              }
              onDelete={confirmDeleteFromWatch}
            />
          )}
        />
      ) : (
        <FlatList
          style={{ backgroundColor: colors.background }}
          contentContainerStyle={padding}
          data={library}
          keyExtractor={(face) => face.id}
          ListHeaderComponent={header}
          ListEmptyComponent={libraryEmpty}
          ItemSeparatorComponent={Separator}
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: face }) => (
            <LibraryFaceCard
              face={face}
              matchedWatchFace={findInstalledFace(face, list?.faces)}
              screenWidth={list?.width}
              screenHeight={list?.height}
              busy={busy}
              connected={connected}
              idle={idle}
              installing={installing}
              installingUrl={installingUrl}
              onPreview={setPreviewFace}
              onSetActive={(id) => void setActive(id)}
              onInstall={handleInstall}
              onDelete={confirmDeleteFromLibrary}
            />
          )}
        />
      )}

      <WatchfacePreviewModal
        previewFace={previewFace}
        list={list}
        tab={tab}
        connected={connected}
        idle={idle}
        installing={installing}
        installingUrl={installingUrl}
        matchedFace={matchedPreview}
        onClose={() => setPreviewFace(null)}
        onInstall={handleInstall}
        onSetActive={(id) => void setActive(id)}
      />

      <ThemedDialog dialog={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  header: { gap: spacing.lg, marginBottom: spacing.md },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  listTitle: { gap: spacing.xs },
  listTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  separator: { height: spacing.md },
  skeletons: { gap: spacing.md },
  progress: { gap: spacing.sm },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  bar: { height: 8, borderRadius: radius.pill },
});
