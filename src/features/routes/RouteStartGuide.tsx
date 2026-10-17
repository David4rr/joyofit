import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Divider, Section } from '@/components/Screen';
import { spacing } from '@/theme';

import { copy } from './copy';
import { NumberedSteps } from './NumberedSteps';

/**
 * How to start a route on the watch, and what the watch will and will not do with it. Collapsed by default; it opens by
 * itself when a route has just been sent (`justSent`), which is when the person needs it.
 */
export function RouteStartGuide({ justSent }: { justSent: boolean }) {
  // Open by itself right after a send; once the person taps, their choice wins.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? justSent;

  return (
    <Section title={copy.guide.title} icon="help-circle" tint="link">
      {open ? (
        <View style={styles.body}>
          <AppText variant="body">{justSent ? copy.guide.sentLead : copy.guide.intro}</AppText>
          <NumberedSteps steps={copy.guide.steps} />
          <AppText variant="caption">{copy.guide.during}</AppText>
          <AppText variant="caption" muted>
            {copy.guide.deleteOnWatch}
          </AppText>
          <Divider />
          <AppText variant="bodyStrong">{copy.guide.limitsTitle}</AppText>
          {copy.guide.limits.map((limit) => (
            <AppText key={limit} variant="caption" muted>
              {`\u2022  ${limit}`}
            </AppText>
          ))}
        </View>
      ) : null}
      <Button
        label={open ? copy.guide.hide : copy.guide.show}
        icon={open ? 'chevron-up' : 'chevron-down'}
        onPress={() => setChosen(!open)}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm },
});
