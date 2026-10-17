import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { isIos } from '@/components/IosUnavailable';
import { Card } from '@/components/Screen';
import { GuideLink } from '@/features/device/GuideLink';
import { Bullet, StepIntro } from '@/features/onboarding/StepIntro';
import { AppleHealthImportSection } from '@/features/settings/AppleHealthImportSection';
import { HuaweiImportSection } from '@/features/settings/HuaweiImportSection';
import { spacing } from '@/theme';

/** Release the watch from Huawei Health, and keep the old history: the two things that cannot be done once the watch is paired here. */
export function UnbindStep() {
  const [importing, setImporting] = useState(false);
  return (
    <>
      <StepIntro icon="unlink" tint="heart" title="Release the watch from Huawei Health">
        A Huawei or Honor watch talks to one app at a time. While Huawei Health holds it, the watch refuses JoyoFit.
      </StepIntro>
      <Card>
        <View style={styles.list}>
          <Bullet label="1">
            Open Huawei Health and pull down on its first screen to sync once more. Anything that is only on the watch and not yet in your
            Huawei account is lost when you unbind.
          </Bullet>
          <Bullet label="2">
            Optional: keep your history. Huawei can send everything Huawei Health stored as a ZIP file, which JoyoFit imports on this phone.
            It can take up to 7 days to arrive, so request it now and import it whenever it comes.
          </Bullet>
          <Bullet label="3">
            In Huawei Health, open the watch under Devices and unbind (remove) it. If it is still connected to another phone, disconnect it
            there too.
          </Bullet>
        </View>
      </Card>
      <Button
        label={importing ? 'Hide the history import' : 'Request or import my Huawei Health history'}
        variant="secondary"
        icon={importing ? 'chevron-up' : 'cloud-download'}
        onPress={() => setImporting((v) => !v)}
      />
      {importing ? (
        <>
          <HuaweiImportSection />
          {isIos ? <AppleHealthImportSection /> : null}
        </>
      ) : null}
      <AppText variant="caption" muted>
        Not sure the unbind worked? Go on: pairing tells you if the watch still refuses. Importing later is always possible from Settings,
        Import from Huawei Health.
      </AppText>
      <GuideLink />
    </>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
});
