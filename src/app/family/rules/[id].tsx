import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { family, type FamilyRules } from '@/cloud/family';
import { AppText } from '@/components/AppText';
import { Divider, Screen, Section } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { prePermissionBody } from '@/features/family/copy';
import { DisclaimerCard } from '@/features/family/DisclaimerCard';
import { describeFamilyError } from '@/features/family/errors';
import { FamilyGate } from '@/features/family/FamilyGate';
import { useFamilyLinks } from '@/features/family/FamilyProvider';
import { ProLockedRow } from '@/features/family/ProLockedRow';
import { PushPermission } from '@/features/family/PushPermission';
import {
  DEFAULT_QUIET,
  NO_STEPS_HOUR,
  NO_SYNC_HOURS,
  normalizeRules,
  QUIET_STEP_MIN,
  quietText,
  shiftClock,
} from '@/features/family/rules';
import { StepperRow } from '@/features/family/StepperRow';
import { useRogoQuery } from '@/features/social/useRogoQuery';

/** How long a burst of taps on a stepper waits before it is saved as one change. */
const SAVE_DELAY_MS = 500;

/**
 * The alert rules of one watched person. A free account changes the "Belum sinkron" switch and its hours; every other row
 * is locked with a Pro badge that opens the offer. A change is saved a moment after the last tap.
 */
export default function RulesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ctx = useFamilyLinks();
  const item = ctx.watching.find((link) => link.id === id);
  const load = useCallback(() => family.links.getRules(id), [id]);
  const { data, error, setData } = useRogoQuery(load, ctx.available, describeFamilyError);
  const [draft, setDraft] = useState<FamilyRules | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saved = data ? normalizeRules(data.rules, DEFAULT_QUIET) : null;
  const rules = draft ?? saved;
  const pro = data?.pro ?? false;
  const problem = error ?? (!item && !ctx.loading ? 'Orang ini tidak ditemukan. Mungkin sudah dihapus.' : null);

  useEffect(() => {
    if (draft === null) return;
    const timer = setTimeout(() => {
      family.links.putRules(id, draft).then(
        (answer) => {
          setData(answer);
          setDraft(null);
        },
        (e) => {
          setSaveError(ctx.fail(e));
          setDraft(null);
        },
      );
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `setData` and `ctx.fail` are not triggers; a new `draft` is
  }, [draft, id]);

  const change = (patch: Partial<FamilyRules>) => {
    if (!rules) return;
    setSaveError(null);
    setDraft({ ...rules, ...patch });
  };

  const locked = () => ctx.showUpsell();

  return (
    <Screen>
      <FamilyGate>
        <Stack.Screen options={{ title: item ? `Pemberitahuan ${item.label}` : 'Pemberitahuan' }} />
        <DisclaimerCard />
        {rules && item ? (
          <>
            <Section title="Belum sinkron" icon="sync" tint="link">
              <SwitchRow
                label="Kabari kalau tidak ada data baru"
                hint={`Notifikasi kalau data ${item.label} berhenti masuk. Gratis.`}
                value={rules.noSync.on}
                onValueChange={(on) => change({ noSync: { ...rules.noSync, on } })}
              />
              {rules.noSync.on ? (
                <StepperRow
                  label="Setelah tanpa data selama"
                  value={`${rules.noSync.hours} jam`}
                  canLess={rules.noSync.hours > NO_SYNC_HOURS.min}
                  canMore={rules.noSync.hours < NO_SYNC_HOURS.max}
                  onLess={() => change({ noSync: { ...rules.noSync, hours: rules.noSync.hours - 1 } })}
                  onMore={() => change({ noSync: { ...rules.noSync, hours: rules.noSync.hours + 1 } })}
                />
              ) : null}
              <AppText variant="caption" muted>
                Hanya dikirim antara jam 07.00 dan 21.00 waktu {item.otherName}.
              </AppText>
            </Section>

            <Section title="Yang terlihat tidak biasa" icon="pulse" tint="heart">
              {pro ? (
                <>
                  <SwitchRow
                    label="Detak jantung istirahat tidak biasa"
                    hint="Jauh lebih tinggi atau lebih rendah dari biasanya."
                    value={rules.restingHr.on}
                    onValueChange={(on) => change({ restingHr: { on } })}
                  />
                  <Divider />
                  <SwitchRow
                    label="Belum ada langkah"
                    hint="Data masuk, tapi langkahnya masih sangat sedikit."
                    value={rules.noSteps.on}
                    onValueChange={(on) => change({ noSteps: { ...rules.noSteps, on } })}
                  />
                  {rules.noSteps.on ? (
                    <StepperRow
                      label="Cek sampai jam"
                      value={`${String(rules.noSteps.hour).padStart(2, '0')}.00`}
                      canLess={rules.noSteps.hour > NO_STEPS_HOUR.min}
                      canMore={rules.noSteps.hour < NO_STEPS_HOUR.max}
                      onLess={() => change({ noSteps: { ...rules.noSteps, hour: rules.noSteps.hour - 1 } })}
                      onMore={() => change({ noSteps: { ...rules.noSteps, hour: rules.noSteps.hour + 1 } })}
                    />
                  ) : null}
                  <Divider />
                  <SwitchRow
                    label="Tidur kurang"
                    hint="Masuk ke ringkasan harian, bukan notifikasi sendiri."
                    value={rules.sleep.on}
                    onValueChange={(on) => change({ sleep: { on } })}
                  />
                  <Divider />
                  <SwitchRow
                    label="Kadar oksigen rendah (kata jam)"
                    hint={
                      item.scopes.spo2
                        ? 'Mati sampai kamu menyalakannya. Angka dari jam, bukan hasil ukur medis.'
                        : `${item.otherName} belum membagikan kadar oksigen, jadi aturan ini belum jalan.`
                    }
                    value={rules.spo2.on}
                    onValueChange={(on) => change({ spo2: { on } })}
                  />
                </>
              ) : (
                <>
                  <ProLockedRow label="Detak jantung istirahat tidak biasa" onPress={locked} />
                  <Divider />
                  <ProLockedRow label="Belum ada langkah" onPress={locked} />
                  <Divider />
                  <ProLockedRow label="Tidur kurang" onPress={locked} />
                  <Divider />
                  <ProLockedRow label="Kadar oksigen rendah (kata jam)" hint="Mati secara bawaan." onPress={locked} />
                </>
              )}
            </Section>

            <Section title="Cara dikabari" icon="mail" tint="steps">
              {pro ? (
                <>
                  <SwitchRow
                    label="Notifikasi di ponsel"
                    value={rules.push}
                    onValueChange={(on) => change({ push: on })}
                  />
                  <SwitchRow
                    label="Email"
                    hint="Rangkuman harian dan pemberitahuan ke email akun JoyoRogo kamu."
                    value={rules.email}
                    onValueChange={(on) => change({ email: on })}
                  />
                </>
              ) : (
                <>
                  <AppText variant="caption" muted>
                    Pemberitahuan &quot;Belum sinkron&quot; datang sebagai notifikasi di ponsel.
                  </AppText>
                  <ProLockedRow label="Email dan rangkuman harian" onPress={locked} />
                </>
              )}
            </Section>

            <Section title="Jam tenang" icon="moon" tint="sleep">
              {pro ? (
                <>
                  <AppText variant="caption" muted>
                    Pemberitahuan yang datang saat jam tenang ditahan sampai selesai. Sekarang: {quietText(rules)}.
                  </AppText>
                  <StepperRow
                    label="Mulai"
                    value={rules.quietStart.replace(':', '.')}
                    onLess={() => change({ quietStart: shiftClock(rules.quietStart, -QUIET_STEP_MIN) })}
                    onMore={() => change({ quietStart: shiftClock(rules.quietStart, QUIET_STEP_MIN) })}
                  />
                  <StepperRow
                    label="Selesai"
                    value={rules.quietEnd.replace(':', '.')}
                    onLess={() => change({ quietEnd: shiftClock(rules.quietEnd, -QUIET_STEP_MIN) })}
                    onMore={() => change({ quietEnd: shiftClock(rules.quietEnd, QUIET_STEP_MIN) })}
                  />
                </>
              ) : (
                <ProLockedRow label="Atur jam tenang" hint={`Sekarang ${quietText(rules)}.`} onPress={locked} />
              )}
            </Section>

            {saveError ? <Notice tone="danger">{saveError}</Notice> : null}
            {draft !== null ? (
              <AppText variant="caption" muted>
                Menyimpan...
              </AppText>
            ) : null}
            <PushPermission
              body={prePermissionBody(item.label)}
              unavailableHint={pro ? 'Kamu masih bisa dikabari lewat email.' : undefined}
            />
          </>
        ) : problem !== null ? (
          <Notice tone="danger">{problem}</Notice>
        ) : (
          <Skeleton width="100%" height={220} radius="card" />
        )}
      </FamilyGate>
    </Screen>
  );
}
