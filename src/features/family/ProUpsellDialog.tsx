import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet } from 'react-native';

import { Button } from '@/components/Button';
import { ProUpsell, type ProUpsellCopy } from '@/features/social/ProUpsell';
import { overlay, spacing } from '@/theme';

/** The Pro offer over the current screen, for a free account that reached a Pro-only row or limit. Back or a tap outside closes it. */
export function ProUpsellDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation(['family', 'common']);
  const copy: ProUpsellCopy = {
    title: t('family:upsell.title'),
    description: t('family:upsell.description'),
    seeLabel: t('family:upsell.see'),
    openLabel: t('family:upsell.open'),
    mention: t('family:upsell.mention'),
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('common:actions.close')}>
        {/* A press on the card itself must not reach the scrim. */}
        <Pressable accessibilityViewIsModal style={styles.card} onPress={() => {}}>
          <ProUpsell copy={copy} campaign="evergreen-family" />
          <Button label={t('common:actions.close')} onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: overlay.scrim, justifyContent: 'center', padding: spacing.lg },
  card: { gap: spacing.sm },
});
