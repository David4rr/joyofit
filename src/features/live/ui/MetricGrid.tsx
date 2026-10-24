import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { heartZone } from '@/features/live/liveWorkout';
import { useHrZones } from '@/features/hrzones/settings';
import { useAnalysisPalette } from '@/features/workouts/analysis/palette';
import { hrZoneColor } from '@/features/workouts/analysis/ui';
import { spacing } from '@/theme';

import { formatMetric } from '../fieldFormat';
import { footKind, rowSizes, type FieldSportKind, type RunMetricId, type RunMetricValues } from '../runFields';
import { useRunLayout } from '../runLayoutStore';
import { MetricPicker } from './MetricPicker';
import { MetricTile } from './MetricTile';

/** What opens the field editor: from the screen's edit button (no slot) or from a long press on a tile (that slot). */
export interface FieldEditor {
  /** Whether the editor is open, and on which slot (null: the overview). */
  state: { open: boolean; slot: number | null };
  open: (slot?: number) => void;
  close: () => void;
}

export function useFieldEditor(): FieldEditor {
  const [state, setState] = useState<{ open: boolean; slot: number | null }>({ open: false, slot: null });
  return {
    state,
    open: (slot) => setState({ open: true, slot: slot ?? null }),
    close: () => setState({ open: false, slot: null }),
  };
}

interface MetricGridProps {
  kind: FieldSportKind;
  values: RunMetricValues;
  editor: FieldEditor;
  /** Metrics this screen can never read; the editor does not offer them. */
  exclude?: readonly RunMetricId[];
}

/**
 * The data fields of a live workout in the layout saved for the sport kind (four or six, the first optionally large). The heart
 * rate tile takes the colour and name of its training zone. A long press on a tile, or the screen's edit button, opens the editor.
 */
export function MetricGrid({ kind, values, editor, exclude }: MetricGridProps) {
  const { t } = useTranslation('sharing');
  const zones = useHrZones();
  const palette = useAnalysisPalette();
  const [layout, setLayout] = useRunLayout(kind);
  const foot = footKind(kind);
  const rows = rowSizes(layout);
  let index = 0;

  return (
    <>
      <View style={styles.grid}>
        {rows.map((size, rowIndex) => {
          const start = index;
          index += size;
          return (
            <View key={rowIndex} style={styles.row}>
              {layout.ids.slice(start, start + size).map((id, offset) => {
                const slot = start + offset;
                const text = formatMetric(id, values[id], foot);
                const hr = id === 'hr' ? values.hr : null;
                const zone = hr !== null && hr !== undefined ? heartZone(hr, zones) : null;
                return (
                  <MetricTile
                    key={id}
                    label={t(`live.fields.metric.${id}`)}
                    value={text.value}
                    unit={text.unit}
                    size={size === 1 ? 'hero' : size === 2 ? 'lg' : 'md'}
                    zone={zone ? { color: hrZoneColor(palette, zone.zone), text: t('live.zone', { zone: zone.zone, label: zone.label }) } : null}
                    longPressHint={t('live.fields.longPress')}
                    onLongPress={() => editor.open(slot)}
                  />
                );
              })}
            </View>
          );
        })}
      </View>
      <MetricPicker
        visible={editor.state.open}
        initialSlot={editor.state.slot}
        layout={layout}
        exclude={exclude}
        onChange={setLayout}
        onClose={editor.close}
      />
    </>
  );
}

const styles = StyleSheet.create({
  grid: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
});
