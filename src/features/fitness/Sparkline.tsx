import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

const HEIGHT = 44;
const PAD = 5;

/** A small line through `values` (oldest first), the last one marked. `domain` fixes the vertical range; otherwise it follows the data. */
export function Sparkline({
  values,
  color,
  label,
  domain,
}: {
  values: readonly number[];
  color: string;
  label: string;
  domain?: readonly [number, number];
}) {
  const [width, setWidth] = useState(0);
  const lo = domain ? domain[0] : Math.min(...values);
  const hi = domain ? domain[1] : Math.max(...values);
  const span = hi - lo || 1;
  const inner = Math.max(0, width - 2 * PAD);
  const x = (i: number) => PAD + (values.length <= 1 ? inner / 2 : (inner * i) / (values.length - 1));
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (HEIGHT - 2 * PAD);
  const last = values.length - 1;
  return (
    <View accessible accessibilityLabel={label} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={styles.wrap}>
      {width > 0 && values.length > 0 ? (
        <Svg width={width} height={HEIGHT}>
          {values.length > 1 ? (
            <Polyline
              points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
          <Circle cx={x(last)} cy={y(values[last])} r={3.5} fill={color} />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { height: HEIGHT, alignSelf: 'stretch' } });
