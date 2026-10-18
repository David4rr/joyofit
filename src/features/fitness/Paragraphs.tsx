import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { spacing } from '@/theme';

/** Several sentences of one explanation, each its own muted caption, for `Details`. */
export function Paragraphs({ lines }: { lines: readonly string[] }) {
  return (
    <View style={styles.wrap}>
      {lines.map((line) => (
        <AppText key={line} variant="caption" muted>
          {line}
        </AppText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
});
