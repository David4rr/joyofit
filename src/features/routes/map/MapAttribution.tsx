import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { mapCopy } from '@/features/routes/map/copy';
import { MAP_INK } from '@/features/routes/map/mapConfig';

interface MapAttributionProps {
  /** More credits under the map's own, e.g. the routing service. */
  extra?: readonly string[];
  /** Where it sits in the map frame; defaults to the bottom left. */
  style?: StyleProp<ViewStyle>;
}

/**
 * The credit every map shows, as visible text over the map (the OpenFreeMap and OpenStreetMap licenses ask for it). The
 * map's own "i" button opens the same credits from the native side. It never takes touches.
 */
export function MapAttribution({ extra = [], style }: MapAttributionProps) {
  return (
    <View pointerEvents="none" style={[styles.anchor, style]}>
      {[mapCopy.attribution, ...extra].map((line) => (
        <AppText key={line} variant="caption" color={MAP_INK.chipText} style={styles.text}>
          {line}
        </AppText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    maxWidth: '78%',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: MAP_INK.chipBackground,
  },
  text: { fontSize: 10.5, lineHeight: 14 },
});
