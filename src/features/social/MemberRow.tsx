import { StyleSheet, View } from 'react-native';

import type { RogoGroupMember, RogoMemberFitness } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { IconChip } from '@/components/IconChip';
import { PillRow, StatPill } from '@/features/social/StatPill';
import { spacing, type Tint } from '@/theme';

/** The scores a member shares, in the colors the Today screen gives them (recovery link, strain workouts, sleep sleep). */
function fitnessPills(fitness: RogoMemberFitness): { label: string; value: string; tint: Tint }[] {
  const pills: { label: string; value: string; tint: Tint }[] = [];
  if (fitness.recoveryPct !== null) pills.push({ label: 'Recovery', value: `${Math.round(fitness.recoveryPct)}%`, tint: 'link' });
  if (fitness.strain !== null) pills.push({ label: 'Strain', value: fitness.strain.toFixed(1), tint: 'workouts' });
  if (fitness.sleepPct !== null) pills.push({ label: 'Sleep', value: `${Math.round(fitness.sleepPct)}%`, tint: 'sleep' });
  if (fitness.readiness !== null) {
    const good = fitness.readiness === 'Primed' || fitness.readiness === 'Balanced';
    pills.push({ label: 'Readiness', value: fitness.readiness, tint: good ? 'link' : 'heart' });
  }
  return pills;
}

/** One member of a group with today's JoyoFit scores when they share them. */
export function MemberRow({ member, isMe }: { member: RogoGroupMember; isMe: boolean }) {
  const pills = member.today.fitness ? fitnessPills(member.today.fitness) : [];
  return (
    <View style={styles.row}>
      <IconChip icon="person" size="sm" />
      <View style={styles.body}>
        <AppText variant="bodyStrong">
          {member.name}
          {isMe ? ' (you)' : ''}
        </AppText>
        {pills.length > 0 ? (
          <PillRow>
            {pills.map((pill) => (
              <StatPill key={pill.label} {...pill} />
            ))}
          </PillRow>
        ) : (
          <AppText variant="caption" muted>
            {member.shareFitness ? 'No JoyoFit scores today' : 'Not sharing JoyoFit scores'}
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
