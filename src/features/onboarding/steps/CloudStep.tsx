import * as Linking from 'expo-linking';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { isIos } from '@/components/IosUnavailable';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { cloudStepState } from '@/features/onboarding/cloudStep';
import { proOffer } from '@/features/onboarding/pro';
import { Bullet, StepIntro } from '@/features/onboarding/StepIntro';
import { SignInButtons } from '@/features/settings/SignInButtons';
import { useCloud } from '@/state/CloudProvider';
import { spacing } from '@/theme';
import { HuaweiWear } from '@/wear';

/** utm convention: docs/utm.md in the joyorogo repo. The Play listing takes the tags in `referrer`. */
const PRO_URL = 'https://joyorogo.com/pro?from=joyofit&utm_source=joyofit&utm_medium=app&utm_campaign=evergreen-onboarding-cloud';
const PLAY_URL =
  'https://play.google.com/store/apps/details?id=com.joyodigitama.joyorogo&referrer=utm_source%3Djoyofit%26utm_medium%3Dapp%26utm_campaign%3Devergreen-onboarding-cloud';

const OFFER = proOffer(isIos ? 'ios' : 'android', HuaweiWear.distribution);

/**
 * JoyoRogo Cloud: every workout, with its analysis, kept in the person's JoyoRogo account. Three faces (see `cloudStepState`): the
 * switch for Pro, an explanation and a store-compliant Pro pointer for Free (same rules as the Pro step), and sign-in. Never blocks.
 */
export function CloudStep() {
  const cloud = useCloud();
  const state = cloudStepState({ signedIn: cloud.signedIn, unlocked: cloud.cloudWorkouts?.unlocked ?? null, locked: cloud.locked });

  // Pro: the switch is on from the start. Turning it on also starts the sync (a Wi-Fi only choice is respected), which is the backfill
  // of the workouts already on the phone. Once per visit; the switch below is the way to turn it off.
  const started = useRef(false);
  useEffect(() => {
    if (state !== 'pro' || started.current) return;
    started.current = true;
    cloud.setAutoSync(true);
  }, [state, cloud]);

  return (
    <>
      <StepIntro icon="cloud-upload" tint="link" title="JoyoRogo Cloud" badge="Opsional / Optional">
        Semua workout dari jam dicadangkan ke akun JoyoRogo kamu, bisa dilihat di joyorogo.com/jam, dan ikut pindah ke HP baru. Kalau HP
        hilang, riwayatmu tidak ikut hilang.
      </StepIntro>
      <Card>
        <AppText variant="heading">Kenapa tidak cukup Health Connect atau Apple Health?</AppText>
        <AppText variant="body" muted>
          Health Connect dan Apple Health menyimpan catatan mentah di perangkat. Itu berguna, tapi JoyoRogo Cloud menyimpan lebih banyak:
        </AppText>
        <View style={styles.bullets}>
          <Bullet label={'\u2022'}>
            Analisisnya ikut tersimpan: split per kilometer, zona detak jantung, best effort, training effect, VO2max, dan waktu pemulihan.
          </Bullet>
          <Bullet label={'\u2022'}>Ada tampilan web di joyorogo.com/jam, tanpa perlu membuka aplikasi.</Bullet>
          <Bullet label={'\u2022'}>Bisa dipulihkan di HP baru setelah masuk, dan ikut pindah antara Android dan iPhone.</Bullet>
        </View>
        <AppText variant="caption" muted>
          Health Connect and Apple Health keep raw records on the device. JoyoRogo Cloud also keeps the analysis (splits, zones, best
          efforts, training effect, VO2max, recovery time), has a web view at joyorogo.com/jam, and restores onto a new phone, including
          between Android and iPhone.
        </AppText>
      </Card>
      {cloud.error ? <Notice tone="danger">{cloud.error}</Notice> : null}
      {state === 'pro' ? (
        <>
          <Card>
            <SwitchRow
              label="Cadangkan workout ke cloud"
              hint="Workout lama dan baru diunggah otomatis setelah sinkron jam."
              icon="cloud-upload"
              value={cloud.autoSync}
              onValueChange={cloud.setAutoSync}
              disabled={cloud.wiping}
            />
            <SwitchRow
              label="Wi-Fi saja"
              hint="Unggahan menunggu Wi-Fi supaya tidak memakai kuota."
              icon="wifi"
              value={cloud.wifiOnly}
              onValueChange={cloud.setWifiOnly}
              disabled={!cloud.autoSync}
            />
          </Card>
          {cloud.progress ? (
            <Notice icon="cloud-upload">{`Mengunggah ${cloud.progress.done} dari ${cloud.progress.total} workout`}</Notice>
          ) : cloud.autoSync ? (
            <Notice icon="checkmark-circle">
              Cadangan aktif. Workout yang sudah ada di HP ini ikut diunggah di latar belakang; kamu tidak perlu menunggu di sini.
            </Notice>
          ) : (
            <Notice icon="information-circle">Cadangan mati. Workout tetap di HP ini. Kamu bisa menyalakannya lagi di Pengaturan, Sinkron cloud.</Notice>
          )}
        </>
      ) : null}
      {state === 'checking' ? <Notice icon="information-circle">Memeriksa akun JoyoRogo kamu...</Notice> : null}
      {state === 'free' ? (
        <>
          <Notice icon="lock-closed">
            Cloud workout adalah fitur JoyoRogo Pro. Akunmu belum Pro, jadi workout tetap hanya di HP ini dan semuanya tetap jalan seperti
            biasa. Kalau nanti Pro, workout yang sudah ada ikut diunggah.
          </Notice>
          {OFFER === 'mention' ? (
            <AppText variant="caption" muted>
              JoyoRogo Pro diatur di dalam JoyoRogo.
            </AppText>
          ) : null}
          {OFFER === 'store' ? (
            <>
              <AppText variant="caption" muted>
                JoyoRogo Pro diatur di aplikasi JoyoRogo.
              </AppText>
              <Button label="Buka JoyoRogo di Google Play" variant="secondary" icon="logo-google-playstore" onPress={() => void Linking.openURL(PLAY_URL)} />
            </>
          ) : null}
          {OFFER === 'web' ? (
            <Button label="Lihat JoyoRogo Pro" variant="secondary" icon="open-outline" onPress={() => void Linking.openURL(PRO_URL)} />
          ) : null}
        </>
      ) : null}
      {state === 'signin' ? (
        <>
          <Notice icon="information-circle">Masuk dengan akun JoyoRogo untuk memakai cloud, atau lewati. JoyoFit tetap jalan penuh tanpa akun.</Notice>
          <SignInButtons label="Masuk dengan JoyoRogo" prompt="Masuk dengan" />
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  bullets: { gap: spacing.sm },
});
