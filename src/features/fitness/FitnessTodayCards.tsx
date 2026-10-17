import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { CountUpText, FadeIn } from '@/components/motion';
import { NavRow } from '@/components/NavRow';
import { Ring } from '@/components/Ring';
import { Card } from '@/components/Screen';
import { Skeleton } from '@/components/States';
import { StatTile } from '@/components/StatTile';
import { computeDailyFitness } from '@/features/fitness/compute';
import { energyWord } from '@/features/fitness/energy';
import { formatHm, formatRecovery, sourceLabel } from '@/features/fitness/format';
import { Sparkline } from '@/features/fitness/Sparkline';
import { useFitnessData } from '@/features/fitness/useFitnessData';
import type { NightHrvAvailability } from '@/features/today/nightHrv';
import { spacing, useColors } from '@/theme';

const SIZE = 92;
const STROKE = 8;

/** Today cards: Energi Tubuh, recovery time and the sleep tonight needs, with a way into the Kebugaran screen. */
export function FitnessTodayCards({ dataVersion, availability }: { dataVersion: number; availability: NightHrvAvailability | null }) {
  const router = useRouter();
  const colors = useColors();
  const { data } = useFitnessData(dataVersion, 'today');
  const daily = useMemo(() => (data ? computeDailyFitness(data, availability) : null), [data, availability]);

  if (!daily) return <Skeleton width="100%" height={220} radius="card" />;

  const { energy, recovery, sleepNeed } = daily;
  const recoveryText = recovery ? formatRecovery(recovery.hoursLeft) : null;

  return (
    <FadeIn>
      <Card>
        <View style={styles.energyRow}>
          <Ring
            size={SIZE}
            stroke={STROKE}
            value={energy?.level ?? 0}
            max={100}
            color={colors.steps}
            track={colors.stepsSoft}
            accessibilityLabel={energy ? `Energi Tubuh ${Math.round(energy.level)} dari 100` : 'Energi Tubuh belum ada'}>
            {energy ? (
              <CountUpText variant="heading" value={Math.round(energy.level)} decimals={0} suffix="" style={styles.value} />
            ) : (
              <AppText variant="heading">--</AppText>
            )}
          </Ring>
          <View style={styles.energyText}>
            <AppText variant="bodyStrong">Energi Tubuh</AppText>
            {energy ? (
              <>
                <AppText variant="caption" muted>
                  {energyWord(energy.level)} - perkiraan
                </AppText>
                <Sparkline values={energy.series.map((p) => p.level)} color={colors.steps} domain={[0, 100]} label="Energi Tubuh sejak bangun tidur" />
              </>
            ) : (
              <AppText variant="caption" muted>
                {daily.energyMissing}
              </AppText>
            )}
          </View>
        </View>
        <Details title="Cara dihitung">
          {`Perkiraan JoyoFit, bukan angka dari jam. Level bangun tidur = 30 + 60 x (tidurmu / kebutuhan tidur, maksimal 1) + sampai 10 poin dari HRV malam. Lalu berkurang 0,8 per jam terjaga, sampai 55 poin dari strain sejak bangun, dan sampai 1 poin per jam saat stres di atas 40. Bertambah 5 per jam tidur siang dan 0,4 per jam saat diam dengan detak jantung dekat istirahat. Hasilnya dibatasi 0 sampai 100.${energy ? ` Sekarang: bangun ${Math.round(energy.wakeLevel)}, terjaga ${energy.parts.awake.toFixed(0)}, strain ${energy.parts.strain.toFixed(0)}, stres ${energy.parts.stress.toFixed(0)}, tidur siang +${energy.parts.naps.toFixed(0)}, istirahat +${energy.parts.rest.toFixed(0)}.` : ''}`}
        </Details>

        <View style={styles.tiles}>
          <StatTile
            icon="hourglass"
            tint="workouts"
            label="Waktu pulih"
            value={recoveryText ? recoveryText.value : '--'}
            unit={recoveryText?.unit}
            sub={recovery ? sourceLabel(recovery.source) : 'Belum ada latihan atau data detak jantung'}
          />
          <StatTile icon="bed" tint="sleep" label="Tidur malam ini" value={formatHm(sleepNeed.needSec)} sub="perkiraan" />
        </View>
        <Details title="Cara dihitung waktu pulih">
          {recovery?.source === 'watch'
            ? 'Dari jam: waktu pemulihan dari latihan terakhir yang dilaporkan jam, dihitung mundur sejak latihan selesai. Kalau ada beberapa latihan, yang terlama yang dipakai.'
            : 'Perkiraan JoyoFit: tidak ada waktu pemulihan dari jam, jadi dihitung dari strain hari ini dan kemarin. Di bawah strain 5 tidak ada waktu pulih, di strain 5 sekitar 6 jam, naik lurus sampai 48 jam di strain 21. Strain kemarin dihitung mundur sejak tengah malam.'}
        </Details>
        <Details title="Cara dihitung kebutuhan tidur">
          {`Perkiraan JoyoFit: dasar 7 j 30 m, ditambah sampai 1 jam dari strain hari ini (strain / 21), ditambah seperempat utang tidur 7 malam terakhir (kurangnya dari 7 j 30 m per malam), maksimal 1 jam.${sleepNeed.strainExtraSec > 0 ? ` Hari ini menambah ${formatHm(sleepNeed.strainExtraSec)}.` : ''}${sleepNeed.debtExtraSec > 0 ? ` Utang tidur menambah ${formatHm(sleepNeed.debtExtraSec)}.` : ''}${sleepNeed.debtSec === null ? ' Utang tidur belum dihitung: butuh minimal 3 malam tercatat.' : ''}`}
        </Details>

        <NavRow icon="analytics" tint="link" title="Kebugaran" subtitle="VO2max, status latihan, prediksi lomba, HRV, menit intensitas" onPress={() => router.push('/fitness')} />
      </Card>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  energyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  energyText: { flex: 1, gap: spacing.xs },
  value: { fontVariant: ['tabular-nums'] },
  tiles: { flexDirection: 'row', gap: spacing.md },
});
