import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { RogoGroupMember, RogoMemberFitness } from '@/cloud/rogo';
import { t } from '@/i18n';
import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { PillRow, StatPill } from '@/features/social/StatPill';
import { spacing, type Tint } from '@/theme';

/** The scores a member shares, in the colors the Today screen gives them (recovery link, strain workouts, sleep sleep). */
function fitnessPills(fitness: RogoMemberFitness): { label: string; value: string; tint: Tint }[] {
  const pills: { label: string; value: string; tint: Tint }[] = [];
  if (fitness.recoveryPct !== null) pills.push({ label: t('social:member.recovery'), value: `${Math.round(fitness.recoveryPct)}%`, tint: 'link' });
  if (fitness.strain !== null) pills.push({ label: t('social:member.strain'), value: fitness.strain.toFixed(1), tint: 'workouts' });
  if (fitness.sleepPct !== null) pills.push({ label: t('social:member.sleep'), value: `${Math.round(fitness.sleepPct)}%`, tint: 'sleep' });
  if (fitness.readiness !== null) {
    const good = fitness.readiness === 'Primed' || fitness.readiness === 'Balanced';
    pills.push({ label: t('social:member.readiness'), value: t(`social:member.readinessValue.${fitness.readiness}`), tint: good ? 'link' : 'heart' });
  }
  return pills;
}

/** One member of a group with today's JoyoFit scores when they share them. */
export function MemberRow({ member, isMe }: { member: RogoGroupMember; isMe: boolean }) {
  const { t } = useTranslation('social');
  const pills = member.today.fitness ? fitnessPills(member.today.fitness) : [];
  return (
    <View style={styles.row}>
      <Avatar name={member.name} image={member.image} size="sm" />
      <View style={styles.body}>
        <AppText variant="bodyStrong">
          {isMe ? t('member.you', { name: member.name }) : member.name}
        </AppText>
        {pills.length > 0 ? (
          <PillRow>
            {pills.map((pill) => (
              <StatPill key={pill.label} {...pill} />
            ))}
          </PillRow>
        ) : (
          <AppText variant="caption" muted>
            {member.shareFitness ? t('member.noScores') : t('member.notSharing')}
          </AppText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  body: { flex: 1, gap: spacing.xs + 2 },
});
