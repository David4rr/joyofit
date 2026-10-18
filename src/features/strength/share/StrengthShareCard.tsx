import { Ionicons } from '@expo/vector-icons';
import { Image, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTranslation } from 'react-i18next';

import { CARD_WIDTH, type PhotoStatus, type ShareBackground, type ShareFormat } from '@/features/share/ShareCard';
import { overlay, useTheme } from '@/theme';

import type { StrengthShareStats } from './strengthShareStats';

/** The card is laid out in the same 1080-wide design pixels as `ShareCard`, so both capture to a 1080 px wide PNG. */
const DESIGN_WIDTH = 1080;
const UNIT = CARD_WIDTH / DESIGN_WIDTH;
const px = (design: number) => design * UNIT;

const WORDMARK = 'JoyoFit'; // i18n-ok: brand
const SITE = 'fit.joyorogo.com'; // i18n-ok: URL

interface Metrics {
  height: number;
  pad: number;
  gap: number;
  icon: number;
  title: number;
  subtitle: number;
  primary: number;
  primaryUnit: number;
  value: number;
  unit: number;
  label: number;
  setName: number;
  setLoad: number;
  badge: number;
  wordmark: number;
  columns: number;
}

const METRICS: Record<ShareFormat, Metrics> = {
  story: {
    height: 1920,
    pad: 72,
    gap: 40,
    icon: 104,
    title: 76,
    subtitle: 34,
    primary: 176,
    primaryUnit: 60,
    value: 88,
    unit: 38,
    label: 32,
    setName: 46,
    setLoad: 50,
    badge: 34,
    wordmark: 46,
    columns: 2,
  },
  square: {
    height: 1080,
    pad: 56,
    gap: 24,
    icon: 88,
    title: 60,
    subtitle: 28,
    primary: 120,
    primaryUnit: 46,
    value: 60,
    unit: 28,
    label: 24,
    setName: 32,
    setLoad: 34,
    badge: 26,
    wordmark: 38,
    columns: 3,
  },
};

interface Props {
  format: ShareFormat;
  background: ShareBackground;
  stats: StrengthShareStats;
  photoUri: string | null;
  onPhotoStatus: (status: PhotoStatus) => void;
}

/**
 * The share image of a strength workout: name and date, the best sets, the headline numbers, the record badge and the
 * JoyoFit wordmark. Same backgrounds as `ShareCard`: the dark card, a photo with a scrim, or a transparent sticker.
 */
export function StrengthShareCard({ format, background, stats, photoUri, onPhotoStatus }: Props) {
  const { t } = useTranslation('strengthshare');
  const { colors, fonts } = useTheme();
  const m = METRICS[format];
  const onDark = background === 'route';
  const ink = colors.heroForeground;
  const soft = onDark ? colors.heroMuted : overlay.inkSoft;
  const shadow: TextStyle = onDark
    ? {}
    : { textShadowColor: overlay.textShadow, textShadowOffset: { width: 0, height: px(3) }, textShadowRadius: px(14) };
  const text = (size: number, font: string, color: string, extra?: TextStyle): TextStyle => ({
    fontFamily: font,
    fontSize: px(size),
    color,
    includeFontPadding: false,
    ...shadow,
    ...extra,
  });

  const [primary, ...rest] = stats.stats;
  const gridRows: (typeof rest)[] = [];
  for (let i = 0; i < rest.length; i += m.columns) gridRows.push(rest.slice(i, i + m.columns));

  return (
    <View collapsable={false} style={[styles.card, { width: CARD_WIDTH, height: px(m.height) }, onDark && { backgroundColor: colors.hero }]}>
      {background === 'photo' && photoUri ? (
        <>
          <Image
            source={{ uri: photoUri }}
            resizeMode="cover"
            fadeDuration={0}
            style={StyleSheet.absoluteFill}
            onLoad={() => onPhotoStatus('ready')}
            onError={() => onPhotoStatus('error')}
          />
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={overlay.scrimInk} stopOpacity={0.55} />
                <Stop offset="0.3" stopColor={overlay.scrimInk} stopOpacity={0} />
                <Stop offset="0.5" stopColor={overlay.scrimInk} stopOpacity={0} />
                <Stop offset="1" stopColor={overlay.scrimInk} stopOpacity={0.8} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#scrim)" />
          </Svg>
        </>
      ) : null}

      <View style={{ flex: 1, padding: px(m.pad), gap: px(m.gap) }}>
        <View style={[styles.row, { gap: px(m.gap) }]}>
          <View
            style={{
              width: px(m.icon),
              height: px(m.icon),
              borderRadius: px(m.icon) / 2,
              backgroundColor: onDark ? colors.heroTrack : overlay.chip,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Ionicons name="barbell" size={px(m.icon * 0.52)} color={ink} />
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={text(m.title, fonts.heavy, ink)}>
              {stats.name}
            </Text>
            <Text numberOfLines={1} style={text(m.subtitle, fonts.medium, soft)}>
              {stats.subtitle}
            </Text>
          </View>
        </View>

        <View style={styles.middle}>
          {stats.topSets.length > 0 ? (
            <View style={{ alignSelf: 'stretch', gap: px(m.gap * 0.6) }}>
              <View style={[styles.row, { gap: px(m.gap) }]}>
                <Text style={text(m.label, fonts.medium, soft)}>{t('topSets')}</Text>
                {stats.prLabel ? (
                  <View style={[styles.row, { gap: px(10), marginLeft: 'auto' }]}>
                    <Ionicons name="trophy" size={px(m.badge)} color={colors.heroAccent} />
                    <Text style={text(m.badge, fonts.bold, colors.heroAccent)}>{stats.prLabel}</Text>
                  </View>
                ) : null}
              </View>
              {stats.topSets.map((set, index) => (
                <View key={index} style={[styles.row, { gap: px(m.gap), alignItems: 'baseline' }]}>
                  <Text numberOfLines={1} style={text(m.setName, fonts.medium, ink, { flex: 1 })}>
                    {set.exercise}
                  </Text>
                  <Text numberOfLines={1} style={text(m.setLoad, fonts.heavy, ink)}>
                    {set.load}
                  </Text>
                </View>
              ))}
            </View>
          ) : stats.prLabel ? (
            <View style={[styles.row, { gap: px(10) }]}>
              <Ionicons name="trophy" size={px(m.badge)} color={colors.heroAccent} />
              <Text style={text(m.badge, fonts.bold, colors.heroAccent)}>{stats.prLabel}</Text>
            </View>
          ) : onDark ? (
            <Ionicons name="barbell" size={px(m.primary)} color={colors.heroTrack} />
          ) : null}
        </View>

        {primary ? (
          <View>
            <Text style={text(m.label, fonts.medium, soft)}>{primary.label}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={text(m.primary, fonts.heavy, ink, { letterSpacing: -px(3) })}>
              {primary.value}
              {primary.unit ? <Text style={text(m.primaryUnit, fonts.bold, soft)}> {primary.unit}</Text> : null}
            </Text>
          </View>
        ) : null}

        {gridRows.length > 0 ? (
          <View style={{ gap: px(m.gap) }}>
            {gridRows.map((cells, rowIndex) => (
              <View key={rowIndex} style={[styles.row, { gap: px(m.gap), alignItems: 'flex-start' }]}>
                {Array.from({ length: m.columns }, (_, col) => {
                  const stat = cells[col];
                  return (
                    <View key={col} style={{ flex: 1 }}>
                      {stat ? (
                        <>
                          <Text style={text(m.label, fonts.medium, soft)}>{stat.label}</Text>
                          <Text numberOfLines={1} adjustsFontSizeToFit style={text(m.value, fonts.heavy, ink, { letterSpacing: -px(1.5) })}>
                            {stat.value}
                            {stat.unit ? <Text style={text(m.unit, fonts.bold, soft)}> {stat.unit}</Text> : null}
                          </Text>
                        </>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        ) : null}

        <View style={[styles.row, styles.footer]}>
          <Text style={text(m.wordmark, fonts.heavy, ink, { letterSpacing: -px(1) })}>{WORDMARK}</Text>
          <Text style={text(m.wordmark * 0.62, fonts.medium, soft)}>{SITE}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center' },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 0 },
  footer: { justifyContent: 'space-between', alignItems: 'baseline' },
});
