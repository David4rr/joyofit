import * as DocumentPicker from 'expo-document-picker';
import { useCallback } from 'react';

import type { CustomDialogState } from '@/features/watchfaces/ThemedDialog';
import { resolveCategory, type WatchfaceItem } from '@/features/watchfaces/watchfaceModel';
import type { DownloadedFace } from '@/features/watchfaces/useWatchfaceLibrary';
import { HuaweiWear, type WatchfaceList } from '@/wear';

interface UseWatchfaceImportParams {
  list: WatchfaceList | null;
  saveToLibrary: (face: DownloadedFace) => void;
  onInstall: (face: WatchfaceItem) => void;
  setDialog: (dialog: CustomDialogState | null) => void;
}

export function useWatchfaceImport({
  list,
  saveToLibrary,
  onInstall,
  setDialog,
}: UseWatchfaceImportParams) {
  const promptInstallAfterSave = useCallback(
    (savedFace: DownloadedFace) => {
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
        onConfirm: () => void onInstall(savedFace),
      });
    },
    [list, onInstall, setDialog],
  );

  const handleImportToMyWatch = useCallback(async () => {
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
  }, [list, promptInstallAfterSave, saveToLibrary, setDialog]);

  return { handleImportToMyWatch, promptInstallAfterSave };
}
