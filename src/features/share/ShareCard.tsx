import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Image, PixelRatio, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Polyline, Rect, Stop } from 'react-native-svg';

import type { IconName } from '@/components/IconChip';
import type { ShareStat } from '@/features/share/shareStats';
import { downsample, projectRoute, type RoutePoint } from '@/features/workouts/summary';
import { overlay, useTheme } from '@/theme';

export type ShareFormat = 'story' | 'square';
/** `sticker` has no background at all: the PNG keeps its alpha so it can be pasted over any photo. */
export type ShareBackground = 'route' | 'photo' | 'sticker';
export type PhotoStatus = 'loading' | 'ready' | 'error';

/**
 * The card is laid out in 1080-wide design pixels and drawn at 1080 / PixelRatio dp, so capturing the
 * mounted view yields a 1080 px wide PNG on any screen. The preview shrinks it with a transform.
 */
const DESIGN_WIDTH = 1080;
export const CARD_WIDTH = DESIGN_WIDTH / PixelRatio.get();
const UNIT = CARD_WIDTH / DESIGN_WIDTH;
const px = (design: number) => design * UNIT;

const WORDMARK = 'JoyoFit'; // i18n-ok: brand
const SITE = 'fit.joyorogo.com'; // i18n-ok: URL

interface Metrics {
  /** Card height in design pixels. */
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
  wordmark: number;
  /** Route drawn big in the middle of the dark card. */
  hero: { w: number; h: number };
  /** Route drawn small over a photo or as a sticker. */
  inset: number;
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
    wordmark: 46,
    hero: { w: 936, h: 700 },
    inset: 400,
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
    wordmark: 38,
    hero: { w: 968, h: 360 },
    inset: 280,
    columns: 3,
  },
};

export function cardHeight(format: ShareFormat): number {
  return px(METRICS[format].height);
}

interface RouteTraceProps {
  route: readonly RoutePoint[];
  width: number;
  height: number;
  stroke: number;
  accent: string;
  start: string;
  end: string;
}

/** The GPS track as an SVG polyline in a `width` x `height` design-pixel box, north up, with a dark halo for legibility. */
function RouteTrace({ route, width, height, stroke, accent, start, end }: RouteTraceProps) {
  const projected = useMemo(
    () => projectRoute(downsample(route, 800), width, height, stroke * 2.5),
    [route, width, height, stroke],
  );
  if (!projected) return null;
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
      <Polyline
        points={projected.polyline}
        fill="none"
        stroke={overlay.halo}
        strokeWidth={stroke * 2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Polyline
        points={projected.polyline}
        fill="none"
        stroke={accent}
        strokeWidth={stroke}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Circle cx={projected.start.x} cy={projected.start.y} r={stroke * 1.1} fill={start} stroke={overlay.ink} strokeWidth={stroke / 3} />
      <Circle cx={projected.end.x} cy={projected.end.y} r={stroke * 1.1} fill={end} stroke={accent} strokeWidth={stroke / 2} />
    </Svg>
  );
}

interface ShareCardProps {
  format: ShareFormat;
  background: ShareBackground;
  title: string;
  subtitle: string;
  icon: IconName;
  stats: readonly ShareStat[];
  route: readonly RoutePoint[];
  photoUri: string | null;
  onPhotoStatus: (status: PhotoStatus) => void;
}

/**
 * The share image: sport and date, the route when there is one, the workout numbers and the JoyoFit
 * wordmark. Fields the workout does not have never reach `stats`, so an indoor workout gets a stats-only
 * card. Draws no background of its own for `sticker`.
 */
export function ShareCard({
  format,
  background,
  title,
  subtitle,
  icon,
  stats,
  route,
  photoUri,
  onPhotoStatus,
}: ShareCardProps) {
  const { colors, fonts } = useTheme();
  const m = METRICS[format];
  const onDark = background === 'route';
  const hasRoute = route.length >= 2;
  const ink = colors.heroForeground;
  const soft = onDark ? colors.heroMuted : overlay.inkSoft;
  // White text over an arbitrary photo or an arbitrary Story needs a shadow to stay readable.
  const shadow: TextStyle = onDark
    ? {}
    : {
        textShadowColor: overlay.textShadow,
        textShadowOffset: { width: 0, height: px(3) },
        textShadowRadius: px(14),
      };
  const text = (size: number, font: string, color: string, extra?: TextStyle): TextStyle => ({
    fontFamily: font,
    fontSize: px(size),
    color,
    includeFontPadding: false,
    ...shadow,
    ...extra,
  });

  const [primary, ...rest] = stats;
  const gridRows: ShareStat[][] = [];
  for (let i = 0; i < rest.length; i += m.columns) gridRows.push(rest.slice(i, i + m.columns));
  // Over a photo or as a sticker the route is a small inset; on story it sits above the numbers,
  // on square beside the first number so the card stays within its height.
  const insetBeside = format === 'square';
  const inset = hasRoute && !onDark ? (
    <View style={{ width: px(m.inset), height: px(m.inset) }}>
      <RouteTrace
        route={route}
        width={m.inset}
        height={m.inset}
        stroke={10}
        accent={colors.heroAccent}
        start={colors.heroLink}
        end={ink}
      />
    </View>
  ) : null;

  return (
    <View
      collapsable={false}
      style={[
        styles.card,
        { width: CARD_WIDTH, height: px(m.height) },
        onDark && { backgroundColor: colors.hero },
      ]}>
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
            <Ionicons name={icon} size={px(m.icon * 0.52)} color={ink} />
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={text(m.title, fonts.heavy, ink)}>
              {title}
            </Text>
            <Text numberOfLines={1} style={text(m.subtitle, fonts.medium, soft)}>
              {subtitle}
            </Text>
          </View>
        </View>

        <View style={styles.middle}>
          {onDark && hasRoute ? (
            <View style={{ width: px(m.hero.w), height: px(m.hero.h), maxHeight: '100%' }}>
              <RouteTrace
                route={route}
                width={m.hero.w}
                height={m.hero.h}
                stroke={14}
                accent={colors.heroAccent}
                start={colors.heroLink}
                end={ink}
              />
            </View>
          ) : onDark ? (
            <Ionicons name={icon} size={px(m.hero.h * 0.6)} color={colors.heroTrack} />
          ) : null}
        </View>

        {!insetBeside ? inset : null}

        <View style={[styles.row, styles.bottomRow, { gap: px(m.gap) }]}>
          {primary ? (
            <View style={{ flex: 1 }}>
              <Text style={text(m.label, fonts.medium, soft)}>{primary.label}</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={text(m.primary, fonts.heavy, ink, { letterSpacing: -px(3) })}>
                {primary.value}
                {primary.unit ? <Text style={text(m.primaryUnit, fonts.bold, soft)}> {primary.unit}</Text> : null}
              </Text>
            </View>
          ) : null}
          {insetBeside ? inset : null}
        </View>

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
  bottomRow: { alignItems: 'flex-end' },
  footer: { justifyContent: 'space-between', alignItems: 'baseline' },
});
