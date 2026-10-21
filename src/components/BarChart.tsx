import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GestureResponderEvent, LayoutChangeEvent } from 'react-native';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { bucketAt, labelledBars, pointAt, nextSelection } from '@/components/barScrub';
import { spacing, useColors } from '@/theme';

const LABEL_HEIGHT = 14;
const MIN_BAR = 3;

interface Scrub {
  selected: number | null;
  /** Spread onto the touchable chart area. */
  touch: {
    ref: React.RefObject<View | null>;
    onLayout: (e: LayoutChangeEvent) => void;
    onTouchStart: (e: GestureResponderEvent) => void;
    onTouchMove: (e: GestureResponderEvent) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
  };
  /** Width of the touch area in px; 0 until laid out. */
  width: number;
  clear: () => void;
}

/**
 * Tap or drag across `count` equal slots (or, in `point` mode, evenly spaced points) to select one; a tap on the selected slot, or outside the slots, clears it.
 * Selection resets when `resetKey` changes (new data).
 */
export function useBarScrub(count: number, resetKey: unknown, left = 0, right = 0, mode: 'slot' | 'point' = 'slot'): Scrub {
  const [selected, setSelected] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const ref = useRef<View>(null);
  const box = useRef({ x: 0, w: 0 });
  const gesture = useRef({ start: null as number | null, last: -1, moved: false });

  useEffect(() => setSelected(null), [resetKey]);

  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, _y, w) => {
      box.current = { x, w };
    });
  }, []);

  const hit = (pageX: number): number => {
    const { x, w } = box.current;
    return (mode === 'slot' ? bucketAt : pointAt)(pageX - x, left, w - left - right, count);
  };

  const onTouchStart = (e: GestureResponderEvent) => {
    gesture.current = { start: selected, last: -1, moved: false };
    const pageX = e.nativeEvent.pageX;
    const i = hit(pageX);
    gesture.current.last = i;
    if (i >= 0) setSelected(i);
    measure();
  };
  const onTouchMove = (e: GestureResponderEvent) => {
    gesture.current.moved = true;
    const i = hit(e.nativeEvent.pageX);
    if (i < 0 || i === gesture.current.last) return;
    gesture.current.last = i;
    setSelected(i);
  };
  const onTouchEnd = () => {
    const { start, last, moved } = gesture.current;
    setSelected(nextSelection(start, last, moved));
  };

  return {
    selected: selected !== null && selected < count ? selected : null,
    width,
    clear: () => setSelected(null),
    touch: {
      ref,
      onLayout: (e) => {
        setWidth(e.nativeEvent.layout.width);
        measure();
      },
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: onTouchEnd,
    },
  };
}

interface ReadoutProps {
  /** The date or hour of the bar. */
  title: string | null;
  /** Its value with the unit. */
  text: string | null;
  color: string;
}

/** One line above a chart: the selected bar's date on the left and its value on the right, or a hint to tap. */
export function BarReadout({ title, text, color }: ReadoutProps) {
  const { t } = useTranslation('common');
  const selected = title !== null && text !== null;
  return (
    <View style={styles.readout} accessibilityLiveRegion="polite" importantForAccessibility="no-hide-descendants">
      {selected ? (
        <>
          <AppText variant="caption" muted numberOfLines={1} style={styles.readoutTitle}>
            {title}
          </AppText>
          <AppText variant="bodyStrong" color={color} numberOfLines={1} style={styles.readoutValue}>
            {text}
          </AppText>
        </>
      ) : (
        <AppText variant="caption" muted numberOfLines={1}>
          {t('chart.hint')}
        </AppText>
      )}
    </View>
  );
}

export interface BarDatum {
  key: string | number;
  value: number;
  /** Date or hour, for the readout and the accessibility label. */
  title: string;
  /** Value with its unit, for the readout and the accessibility label. */
  text: string;
  /** Short value for the label above the bar (no unit). */
  short: string;
  /** Draws the bar dimmed, like a past period. */
  dim?: boolean;
}

interface BarChartProps {
  data: readonly BarDatum[];
  color: string;
  /** Height of the bars area, without the label row. */
  height: number;
  gap: number;
  /** The tick under bar `i`, or null for none. */
  tick: (index: number) => string | null;
  tickWidth: number;
  /** The bar that gets a value label when labels do not fit for all; the newest by default. */
  current?: number;
}

/**
 * Bars made of plain Views, scaled to the tallest. Touch shows a readout above and highlights the bar; the selected (or
 * current) bar carries its value, and with few bars every bar does when the labels fit.
 */
export function BarChart({ data, color, height, gap, tick, tickWidth, current }: BarChartProps) {
  const colors = useColors();
  const scrub = useBarScrub(data.length, data);
  const peak = Math.max(0, ...data.map((d) => d.value));
  const highlighted = scrub.selected ?? current ?? data.length - 1;
  const labelled = labelledBars(data.length, scrub.width, data.map((d) => d.short), highlighted);
  const picked = scrub.selected !== null ? data[scrub.selected]! : null;

  return (
    <View style={styles.wrap}>
      <BarReadout title={picked?.title ?? null} text={picked?.text ?? null} color={color} />
      <View {...scrub.touch} style={[styles.bars, { height: height + LABEL_HEIGHT, gap }]}>
        {data.map((d, i) => {
          const isSelected = i === scrub.selected;
          const dimmed = scrub.selected !== null ? !isSelected : d.dim === true;
          return (
            <View key={d.key} accessible accessibilityLabel={`${d.title}: ${d.text}`} style={styles.slot}>
              {labelled.has(i) && d.value > 0 ? (
                <AppText
                  variant="caption"
                  color={isSelected ? color : undefined}
                  muted={!isSelected}
                  numberOfLines={1}
                  style={[styles.value, { width: Math.max(32, tickWidth) }]}>
                  {d.short}
                </AppText>
              ) : null}
              <View
                style={[
                  styles.bar,
                  d.value > 0
                    ? { height: Math.max(MIN_BAR, (d.value / peak) * height), backgroundColor: color, opacity: dimmed ? 0.5 : 1 }
                    : { height: MIN_BAR, backgroundColor: colors.muted },
                ]}
              />
            </View>
          );
        })}
      </View>
      <View style={[styles.axis, { gap }]} pointerEvents="none">
        {data.map((d, i) => {
          const label = tick(i);
          return (
            <View key={d.key} style={styles.slot}>
              {label !== null ? (
                <AppText
                  variant="caption"
                  muted
                  numberOfLines={1}
                  style={[styles.tick, { width: tickWidth }]}>
                  {label}
                </AppText>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  readout: { minHeight: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  readoutTitle: { flexShrink: 1 },
  readoutValue: { fontVariant: ['tabular-nums'] },
  bars: { flexDirection: 'row', alignItems: 'flex-end' },
  slot: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  value: { textAlign: 'center', fontSize: 11, lineHeight: 14, fontVariant: ['tabular-nums'] },
  bar: { alignSelf: 'stretch', borderTopLeftRadius: 3, borderTopRightRadius: 3, borderBottomLeftRadius: 1, borderBottomRightRadius: 1 },
  axis: { flexDirection: 'row' },
  tick: { textAlign: 'center', fontSize: 11, lineHeight: 15 },
});
