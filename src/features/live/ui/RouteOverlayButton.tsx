import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { formatRouteDistance } from '@/features/routes/routeModel';
import { spacing, useTheme } from '@/theme';

import type { OverlayRoute } from '../overlayRoute';

/** A button naming the route drawn on the live map (or asking to choose one); it opens the list of saved routes and "no route". */
export function RouteOverlayButton({ overlay }: { overlay: OverlayRoute }) {
  const { t } = useTranslation('sharing');
  const { colors, radius } = useTheme();
  const [picking, setPicking] = useState(false);
  const chosen = overlay.selected?.route ?? null;

  return (
    <>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={chosen ? t('live.route.chosen', { name: chosen.name }) : t('live.route.choose')}
        onPress={() => setPicking(true)}
        scaleTo={0.96}
        style={[styles.button, { backgroundColor: colors.muted, borderRadius: radius.control }]}>
        <Ionicons name="trail-sign" size={18} color={chosen ? colors.link : colors.foreground} />
        <AppText variant="label" numberOfLines={1} style={styles.label}>
          {chosen ? chosen.name : t('live.route.choose')}
        </AppText>
      </PressableScale>
      <RoutePicker visible={picking} overlay={overlay} onClose={() => setPicking(false)} />
    </>
  );
}

interface RoutePickerProps {
  visible: boolean;
  overlay: OverlayRoute;
  onClose: () => void;
}

/** The saved routes to draw on the live map, and "no route". */
function RoutePicker({ visible, overlay, onClose }: RoutePickerProps) {
  const { t } = useTranslation('sharing');
  const { colors, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const selectedId = overlay.selected?.route.id ?? null;

  const choose = (id: string | null) => {
    overlay.select(id);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.sheet, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.sheetHeader}>
          <AppText variant="heading" accessibilityRole="header" style={styles.sheetTitle}>
            {t('live.route.title')}
          </AppText>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('live.fields.close')}
            onPress={onClose}
            style={[styles.close, { backgroundColor: colors.muted, borderRadius: radius.control }]}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </PressableScale>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.sm }}>
          <PickRow label={t('live.route.none')} selected={selectedId === null} onPress={() => choose(null)} />
          {overlay.routes.map((route) => (
            <PickRow
              key={route.id}
              label={route.name}
              detail={formatRouteDistance(route.distanceM)}
              selected={route.id === selectedId}
              onPress={() => choose(route.id)}
            />
          ))}
          {overlay.routes.length === 0 ? (
            <AppText variant="caption" muted>
              {t('live.route.empty')}
            </AppText>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function PickRow({ label, detail, selected, onPress }: { label: string; detail?: string; selected: boolean; onPress: () => void }) {
  const { colors, radius } = useTheme();
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      scaleTo={0.98}
      onPress={onPress}
      style={[styles.row, { backgroundColor: selected ? colors.muted : 'transparent', borderRadius: radius.control }]}>
      <View style={styles.rowText}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {label}
        </AppText>
        {detail ? (
          <AppText variant="caption" muted>
            {detail}
          </AppText>
        ) : null}
      </View>
      {selected ? <Ionicons name="checkmark" size={22} color={colors.primary} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44, paddingHorizontal: spacing.md, maxWidth: '55%' },
  label: { flexShrink: 1 },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  sheetTitle: { flex: 1 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  rowText: { flex: 1, gap: 1 },
});
