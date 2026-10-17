import { useSQLiteContext } from 'expo-sqlite';
import { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { FadeIn } from '@/components/motion';
import { Metric } from '@/components/Metric';
import { KeyValue } from '@/components/KeyValue';
import { Ring } from '@/components/Ring';
import { Screen, Section } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { computeFitnessOverview } from '@/features/fitness/compute';
import { formatRaceTime, sourceLabel } from '@/features/fitness/format';
import { WEEKLY_TARGET_MIN } from '@/features/fitness/intensityMinutes';
import { recentRuns, useRunEfforts } from '@/features/fitness/runEfforts';
import { Sparkline } from '@/features/fitness/Sparkline';
import { CHRONIC_DAYS, type TrainingStatus } from '@/features/fitness/trainingLoad';
import { useFitnessData } from '@/features/fitness/useFitnessData';
import { availabilityText } from '@/features/today/nightHrv';
import { useNightHrvAvailability } from '@/features/today/useNightHrvAvailability';
import { TrendChart } from '@/features/trends/TrendChart';
import { dayStarts } from '@/features/trends/series';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useColors } from '@/theme';

const STATUS_WORD: Record<TrainingStatus, { word: string; hint: string }> = {
  productive: { word: 'Produktif', hint: 'Beban minggu ini di atas biasanya: kebugaran sedang dibangun.' },
  maintaining: { word: 'Menjaga', hint: 'Beban minggu ini setara dengan biasanya.' },
  recovery: { word: 'Pemulihan', hint: 'Beban minggu ini lebih ringan dari biasanya.' },
  overreaching: { word: 'Terlalu berat', hint: 'Beban naik tajam. Beri badanmu waktu untuk pulih.' },
  detraining: { word: 'Menurun', hint: 'Beban jauh di bawah biasanya: kebugaran bisa turun.' },
};

const HRV_WORD = { balanced: 'Seimbang', unbalanced: 'Tidak seimbang', low: 'Rendah' } as const;
const HRV_HINT = {
  balanced: 'HRV 7 malam terakhir ada di rentang normalmu.',
  low: 'HRV 7 malam terakhir di bawah rentang normalmu. Biasanya tanda lelah, kurang tidur, atau sakit.',
  unbalanced: 'HRV 7 malam terakhir di atas rentang normalmu. Sering terjadi setelah sakit atau jeda latihan.',
} as const;

function Tag({ source }: { source: 'watch' | 'estimate' }) {
  return (
    <AppText variant="caption" muted>
      {sourceLabel(source)}
    </AppText>
  );
}

/** Kebugaran: VO2max, training status and load, race predictions, HRV status and the week's intensity minutes. */
export function FitnessScreen() {
  const db = useSQLiteContext();
  const colors = useColors();
  const { linkState, device, dataVersion, sync } = useWatch();
  const { data, error } = useFitnessData(dataVersion, 'full');
  const availability = useNightHrvAvailability(dataVersion);
  const canSync = linkState === 'connected' && device !== null;

  const runs = useMemo(() => (data ? recentRuns(data.workouts, data.nowSec) : null), [data]);
  const efforts = useRunEfforts(db, runs);
  const view = useMemo(() => (data && efforts ? computeFitnessOverview(data, efforts) : null), [data, efforts]);
  // Everything but the race predictor is ready as soon as the data is; the predictor waits for the GPS points of the runs.
  const early = useMemo(() => (data ? computeFitnessOverview(data, []) : null), [data]);
  const shown = view ?? early;

  const loadDays = useMemo(() => (data ? dayStarts(data.dayStart, CHRONIC_DAYS) : []), [data]);
  const loadSeries = useMemo(() => {
    if (!data) return [];
    const byDay = new Map(data.strain.map((d) => [d.day, d.trimp]));
    return loadDays.map((day) => byDay.get(day) ?? null);
  }, [data, loadDays]);

  const ios = Platform.OS === 'ios';

  return (
    <Screen refresh={{ refreshing: linkState === 'syncing', onRefresh: () => void sync(), enabled: canSync }}>
      <HiddenTabHeader title="Kebugaran" />
      {error ? <Notice tone="danger">Gagal membaca data tersimpan: {error}</Notice> : null}
      {!data || !shown ? (
        error ? null : <Skeleton width="100%" height={260} radius="card" />
      ) : (
        <>
          <FadeIn>
            <Section title="VO2max" icon="pulse" tint="heart">
              {shown.vo2 ? (
                <>
                  <View style={styles.row}>
                    <Metric value={shown.vo2.value.toFixed(shown.vo2.source === 'watch' ? 0 : 1)} unit="ml/kg/mnt" size="lg" color={colors.heartText} unitColor={colors.mutedForeground} />
                    <View style={styles.text}>
                      <Tag source={shown.vo2.source} />
                      {shown.vo2.delta !== null ? (
                        <AppText variant="caption" muted>
                          {shown.vo2.delta >= 0 ? '+' : ''}
                          {shown.vo2.delta.toFixed(shown.vo2.source === 'watch' ? 0 : 1)} sejak {new Date(shown.vo2.trend[0].at * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                        </AppText>
                      ) : null}
                    </View>
                  </View>
                  {shown.vo2.trend.length > 1 ? <Sparkline values={shown.vo2.trend.map((p) => p.value)} color={colors.heart} label="Tren VO2max" /> : null}
                </>
              ) : (
                <AppText variant="caption" muted>
                  Belum ada VO2max. Jam melaporkannya setelah latihan lari atau jalan dengan GPS, atau JoyoFit memperkirakannya dari detak jantung istirahat setelah 5 hari tercatat.
                </AppText>
              )}
              <Details title="Cara dihitung">
                {`Dari jam: nilai VO2max yang dilaporkan jam pada latihan terakhir (90 hari). Jam mengirim METs maksimal; JoyoFit mengalikannya 3,5 ml/kg/mnt per MET, dengan pembulatan ke bawah ke bilangan bulat, jadi bisa 1 di bawah angka di jam. Nilai di luar 10 sampai 90 diabaikan. Perkiraan (kalau jam tidak melaporkan): Uth-Sorensen 2004, VO2max = 15,3 x detak jantung maksimal / detak jantung istirahat. Maksimal dihitung 220 dikurangi umur dari profil, istirahat adalah median detak jantung terendah harian 14 hari terakhir. Kasar: angka sebenarnya bisa meleset beberapa poin.`}
              </Details>
            </Section>
          </FadeIn>

          <FadeIn delay={40}>
            <Section title="Status latihan" icon="trending-up" tint="workouts">
              {shown.load.kind === 'ok' ? (
                <>
                  <View style={styles.row}>
                    <Metric value={STATUS_WORD[shown.load.status].word} size="md" color={colors.workoutsText} />
                    <View style={styles.text}>
                      <AppText variant="caption" muted>
                        Rasio {shown.load.ratio.toFixed(2)} - perkiraan
                      </AppText>
                    </View>
                  </View>
                  <AppText variant="caption" muted>
                    {STATUS_WORD[shown.load.status].hint}
                  </AppText>
                  <KeyValue icon="flash-outline" label="Rata-rata 7 hari terakhir" value={`${Math.round(shown.load.acute)} TRIMP/hari`} />
                  <KeyValue icon="calendar-outline" label="Rata-rata 28 hari terakhir" value={`${Math.round(shown.load.chronic)} TRIMP/hari`} />
                  <TrendChart values={loadSeries} kind="bar" color={colors.workouts} firstDay={loadDays[0]} label="TRIMP per hari, 28 hari terakhir" endLabel="Kemarin" />
                </>
              ) : (
                <AppText variant="caption" muted>
                  {shown.load.kind === 'short'
                    ? `Butuh minimal 14 hari dengan detak jantung tersimpan: baru ${shown.load.daysWithData} hari.`
                    : 'Tidak ada beban latihan dalam 28 hari terakhir.'}
                </AppText>
              )}
              <Details title="Cara dihitung">
                {`Perkiraan JoyoFit dari detak jantung yang disimpan jam. Beban harian = TRIMP Edwards (menit di zona 1 sampai 5 dikali 1 sampai 5). Rasio = rata-rata TRIMP 7 hari terakhir dibagi rata-rata 28 hari terakhir (Gabbett 2016), hari ini tidak ikut. Di atas 1,5 terlalu berat, 1,1 sampai 1,5 produktif, 0,8 sampai 1,1 menjaga, 0,5 sampai 0,8 pemulihan, di bawah 0,5 menurun. Angka yang sama dipakai di Kesiapan. Hari tanpa data dianggap istirahat.`}
              </Details>
            </Section>
          </FadeIn>

          <FadeIn delay={80}>
            <Section title="Prediksi lomba" icon="trophy" tint="steps">
              {view === null ? (
                <Skeleton width="100%" height={96} radius="card" />
              ) : view.races.kind === 'ok' ? (
                <>
                  {view.races.predictions.map((p) => (
                    <KeyValue key={p.key} icon="stopwatch-outline" label={p.label} value={formatRaceTime(p.seconds)} />
                  ))}
                  <AppText variant="caption" muted>
                    Perkiraan, dari catatan terbaikmu di lari 90 hari terakhir.
                  </AppText>
                </>
              ) : (
                <AppText variant="caption" muted>
                  {`Butuh minimal ${view.races.need} lari dengan jarak 5 km atau lebih dalam 90 hari terakhir (GPS): baru ${view.races.runs}.`}
                </AppText>
              )}
              <Details title="Cara dihitung">
                {`Perkiraan JoyoFit dengan rumus Riegel (1981): T2 = T1 x (D2 / D1)^1,06. T1 adalah catatan tercepat 5K, 10K, atau setengah maraton dari lari 90 hari terakhir (sama dengan rekor terbaik di rincian latihan). Tiap jarak memakai catatan dengan jarak terdekat. Maraton dari catatan 5K cenderung terlalu optimis kalau kamu belum latihan lari panjang.`}
              </Details>
            </Section>
          </FadeIn>

          <FadeIn delay={120}>
            <Section title="Status HRV" icon="heart" tint="heart">
              {ios ? (
                <Notice icon="phone-portrait-outline">{availabilityText(availability) ?? 'Night HRV is not read on iPhone yet'}</Notice>
              ) : 'status' in shown.hrv ? (
                <>
                  <View style={styles.row}>
                    <Metric value={HRV_WORD[shown.hrv.status.state]} size="md" color={colors.heartText} />
                    <View style={styles.text}>
                      <AppText variant="caption" muted>
                        {Math.round(shown.hrv.status.recentMs)} ms, perkiraan
                      </AppText>
                    </View>
                  </View>
                  <AppText variant="caption" muted>
                    {HRV_HINT[shown.hrv.status.state]}
                  </AppText>
                  <KeyValue label="Rentang normalmu" value={`${Math.round(shown.hrv.status.lowMs)} sampai ${Math.round(shown.hrv.status.highMs)} ms`} />
                  <KeyValue label="Rata-rata 7 malam" value={`${Math.round(shown.hrv.status.recentMs)} ms (${shown.hrv.status.recentNights} malam)`} />
                </>
              ) : (
                <AppText variant="caption" muted>
                  {`Belum ada status: ${shown.hrv.missing}. ${availabilityText(availability) ?? ''}`.trim()}
                </AppText>
              )}
              <Details title="Cara dihitung">
                {`Perkiraan JoyoFit dari HRV malam (RMSSD) yang dicatat jam saat tidur, hanya di Android. Rata-rata ln(RMSSD) 7 malam terakhir dibandingkan dengan rentang normalmu: rata-rata 60 hari sebelum minggu itu, plus minus 1 simpangan baku (Plews 2013, Buchheit 2014). Di dalam rentang: seimbang. Di bawah: rendah. Di atas: tidak seimbang. Butuh 14 malam baseline dan 3 malam dalam 7 hari terakhir.`}
              </Details>
            </Section>
          </FadeIn>

          <FadeIn delay={160}>
            <Section title="Menit intensitas" icon="timer" tint="link">
              <View style={styles.row}>
                <Ring
                  size={84}
                  stroke={8}
                  value={shown.intensity.total}
                  max={WEEKLY_TARGET_MIN}
                  color={colors.link}
                  track={colors.linkSoft}
                  accessibilityLabel={`${Math.round(shown.intensity.total)} dari ${WEEKLY_TARGET_MIN} menit intensitas minggu ini`}>
                  <AppText variant="heading" style={styles.figure}>
                    {Math.round(shown.intensity.total)}
                  </AppText>
                </Ring>
                <View style={styles.text}>
                  <AppText variant="bodyStrong">Minggu ini, target {WEEKLY_TARGET_MIN} menit</AppText>
                  <AppText variant="caption" muted>
                    {Math.round(shown.intensity.moderate)} menit sedang + 2 x {Math.round(shown.intensity.vigorous)} menit berat. Perkiraan.
                  </AppText>
                </View>
              </View>
              <TrendChart
                values={shown.intensity.days.map((d) => (d.day <= data.dayStart ? d.total : null))}
                kind="bar"
                color={colors.link}
                firstDay={shown.intensity.weekStart}
                label="Menit intensitas per hari, Senin sampai Minggu"
                endLabel="Minggu"
              />
              <Details title="Cara dihitung">
                {`Perkiraan JoyoFit dari detak jantung per menit yang disimpan jam (maksimal ${data.maxHr} bpm). Menit di 60 sampai 80 persen maksimal (zona 2 dan 3) dihitung 1, menit di 80 persen ke atas (zona 4 dan 5) dihitung 2. Minggu dihitung Senin sampai Minggu. Target 150 menit per minggu mengikuti anjuran WHO 2020 dan ACSM 2018.`}
              </Details>
            </Section>
          </FadeIn>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  text: { flex: 1, gap: 2 },
  figure: { fontVariant: ['tabular-nums'] },
});
