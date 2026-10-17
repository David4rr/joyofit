import { Modal, Pressable, StyleSheet } from 'react-native';

import { Button } from '@/components/Button';
import { ProUpsell, type ProUpsellCopy } from '@/features/social/ProUpsell';
import { overlay, spacing } from '@/theme';

const COPY: ProUpsellCopy = {
  title: 'Ini untuk JoyoRogo Pro',
  description:
    'Memantau sampai 5 orang, semua pemberitahuan (detak jantung, langkah, tidur, kadar oksigen), email, dan riwayat sampai 90 hari ada di JoyoRogo Pro. Yang memantau yang berlangganan: orang yang kamu pantau tidak pernah dikenai biaya. Pemberitahuan "Belum sinkron" tetap gratis.',
  seeLabel: 'Lihat JoyoRogo Pro',
  openLabel: 'Buka JoyoRogo',
  mention: 'JoyoRogo Pro diatur di dalam aplikasi JoyoRogo.',
};

/** The Pro offer over the current screen, for a free account that reached a Pro-only row or limit. Back or a tap outside closes it. */
export function ProUpsellDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Tutup">
        {/* A press on the card itself must not reach the scrim. */}
        <Pressable accessibilityViewIsModal style={styles.card} onPress={() => {}}>
          <ProUpsell copy={COPY} campaign="evergreen-family" />
          <Button label="Tutup" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: overlay.scrim, justifyContent: 'center', padding: spacing.lg },
  card: { gap: spacing.sm },
});
