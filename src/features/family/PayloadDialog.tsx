import { Modal, Pressable, ScrollView, StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { overlay, spacing, useTheme } from '@/theme';

interface PayloadDialogProps {
  visible: boolean;
  /** The exact body of the last upload, as the Worker stored it; null when nothing has been sent. */
  payload: string | null;
  /** When that upload arrived, already worded. */
  at: string | null;
  onClose: () => void;
}

/** What the phone last sent, character for character, so the person can see there is nothing more than they agreed to. */
export function PayloadDialog({ visible, payload, at, onClose }: PayloadDialogProps) {
  const { colors, radius } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Tutup">
        {/* A press on the card itself must not reach the scrim. */}
        <Pressable
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.hairline, borderRadius: radius.card }]}
          onPress={() => {}}>
          <AppText variant="heading" accessibilityRole="header">
            Data yang terkirim
          </AppText>
          {payload === null ? (
            <AppText variant="body">Belum ada data yang terkirim.</AppText>
          ) : (
            <>
              {at ? (
                <AppText variant="caption" muted>
                  Terkirim {at}. Persis seperti ini yang disimpan server:
                </AppText>
              ) : null}
              <ScrollView style={[styles.box, { backgroundColor: colors.muted, borderRadius: radius.input }]} contentContainerStyle={styles.boxContent}>
                <AppText variant="mono" selectable>
                  {payload}
                </AppText>
              </ScrollView>
            </>
          )}
          <Button label="Tutup" variant="primary" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: overlay.scrim, justifyContent: 'center', padding: spacing.lg },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.md },
  box: { maxHeight: 320 },
  boxContent: { padding: spacing.md },
});
