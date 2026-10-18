import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  clockText,
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
  const { t } = useTranslation(['family', 'common']);
  const ctx = useFamilyLinks();
  const item = ctx.watching.find((link) => link.id === id);
  const load = useCallback(() => family.links.getRules(id), [id]);
  const { data, error, setData } = useRogoQuery(load, ctx.available, describeFamilyError);
  const [draft, setDraft] = useState<FamilyRules | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saved = data ? normalizeRules(data.rules, DEFAULT_QUIET) : null;
  const rules = draft ?? saved;
  const pro = data?.pro ?? false;
  const problem = error ?? (!item && !ctx.loading ? t('family:rules.notFound') : null);

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
        <Stack.Screen options={{ title: item ? t('family:title.rulesFor', { label: item.label }) : t('family:title.rules') }} />
        <DisclaimerCard />
        {rules && item ? (
          <>
            <Section title={t('family:rules.noSyncSection')} icon="sync" tint="link">
              <SwitchRow
                label={t('family:rules.noSyncLabel')}
                hint={t('family:rules.noSyncHint', { label: item.label })}
                value={rules.noSync.on}
                onValueChange={(on) => change({ noSync: { ...rules.noSync, on } })}
              />
              {rules.noSync.on ? (
                <StepperRow
                  label={t('family:rules.noSyncAfter')}
                  value={t('family:rules.hoursValue', { count: rules.noSync.hours })}
                  canLess={rules.noSync.hours > NO_SYNC_HOURS.min}
                  canMore={rules.noSync.hours < NO_SYNC_HOURS.max}
                  onLess={() => change({ noSync: { ...rules.noSync, hours: rules.noSync.hours - 1 } })}
                  onMore={() => change({ noSync: { ...rules.noSync, hours: rules.noSync.hours + 1 } })}
                />
              ) : null}
              <AppText variant="caption" muted>
                {t('family:rules.daytime', { from: clockText('07:00'), to: clockText('21:00'), name: item.otherName })}
              </AppText>
            </Section>

            <Section title={t('family:rules.unusualSection')} icon="pulse" tint="heart">
              {pro ? (
                <>
                  <SwitchRow
                    label={t('family:rules.restingHr')}
                    hint={t('family:rules.restingHrHint')}
                    value={rules.restingHr.on}
                    onValueChange={(on) => change({ restingHr: { on } })}
                  />
                  <Divider />
                  <SwitchRow
                    label={t('family:rules.noSteps')}
                    hint={t('family:rules.noStepsHint')}
                    value={rules.noSteps.on}
                    onValueChange={(on) => change({ noSteps: { ...rules.noSteps, on } })}
                  />
                  {rules.noSteps.on ? (
                    <StepperRow
                      label={t('family:rules.noStepsUntil')}
                      value={clockText(`${String(rules.noSteps.hour).padStart(2, '0')}:00`)}
                      canLess={rules.noSteps.hour > NO_STEPS_HOUR.min}
                      canMore={rules.noSteps.hour < NO_STEPS_HOUR.max}
                      onLess={() => change({ noSteps: { ...rules.noSteps, hour: rules.noSteps.hour - 1 } })}
                      onMore={() => change({ noSteps: { ...rules.noSteps, hour: rules.noSteps.hour + 1 } })}
                    />
                  ) : null}
                  <Divider />
                  <SwitchRow
                    label={t('family:rules.sleep')}
                    hint={t('family:rules.sleepHint')}
                    value={rules.sleep.on}
                    onValueChange={(on) => change({ sleep: { on } })}
                  />
                  <Divider />
                  <SwitchRow
                    label={t('family:rules.spo2')}
                    hint={
                      item.scopes.spo2
                        ? t('family:rules.spo2Shared')
                        : t('family:rules.spo2NotShared', { name: item.otherName })
                    }
                    value={rules.spo2.on}
                    onValueChange={(on) => change({ spo2: { on } })}
                  />
                </>
              ) : (
                <>
                  <ProLockedRow label={t('family:rules.restingHr')} onPress={locked} />
                  <Divider />
                  <ProLockedRow label={t('family:rules.noSteps')} onPress={locked} />
                  <Divider />
                  <ProLockedRow label={t('family:rules.sleep')} onPress={locked} />
                  <Divider />
                  <ProLockedRow label={t('family:rules.spo2')} hint={t('family:rules.spo2Locked')} onPress={locked} />
                </>
              )}
            </Section>

            <Section title={t('family:rules.channelsSection')} icon="mail" tint="steps">
              {pro ? (
                <>
                  <SwitchRow
                    label={t('family:rules.push')}
                    value={rules.push}
                    onValueChange={(on) => change({ push: on })}
                  />
                  <SwitchRow
                    label={t('family:rules.email')}
                    hint={t('family:rules.emailHint')}
                    value={rules.email}
                    onValueChange={(on) => change({ email: on })}
                  />
                </>
              ) : (
                <>
                  <AppText variant="caption" muted>
                    {t('family:rules.freeChannel')}
                  </AppText>
                  <ProLockedRow label={t('family:rules.emailLocked')} onPress={locked} />
                </>
              )}
            </Section>

            <Section title={t('family:rules.quietSection')} icon="moon" tint="sleep">
              {pro ? (
                <>
                  <AppText variant="caption" muted>
                    {t('family:rules.quietIntro', { range: quietText(rules) })}
                  </AppText>
                  <StepperRow
                    label={t('family:rules.quietStart')}
                    value={clockText(rules.quietStart)}
                    onLess={() => change({ quietStart: shiftClock(rules.quietStart, -QUIET_STEP_MIN) })}
                    onMore={() => change({ quietStart: shiftClock(rules.quietStart, QUIET_STEP_MIN) })}
                  />
                  <StepperRow
                    label={t('family:rules.quietEnd')}
                    value={clockText(rules.quietEnd)}
                    onLess={() => change({ quietEnd: shiftClock(rules.quietEnd, -QUIET_STEP_MIN) })}
                    onMore={() => change({ quietEnd: shiftClock(rules.quietEnd, QUIET_STEP_MIN) })}
                  />
                </>
              ) : (
                <ProLockedRow label={t('family:rules.quietLocked')} hint={t('family:rules.quietLockedHint', { range: quietText(rules) })} onPress={locked} />
              )}
            </Section>

            {saveError ? <Notice tone="danger">{saveError}</Notice> : null}
            {draft !== null ? (
              <AppText variant="caption" muted>
                {t('family:rules.saving')}
              </AppText>
            ) : null}
            <PushPermission
              body={prePermissionBody(item.label)}
              unavailableHint={pro ? t('family:push.emailHint') : undefined}
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
