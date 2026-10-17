import Svg, { Circle, Rect } from 'react-native-svg';

/**
 * The Instagram Glyph: a rounded-square outline, the lens circle and the flash dot, drawn as one color so it takes the
 * button's foreground. Instagram's brand guidelines allow the Glyph on a control that links to an Instagram feature
 * (here: send to Stories); the glyph is not recolored into the gradient and carries no wordmark.
 * Source: https://about.meta.com/brand/resources/instagram/instagram-brand/ (Glyph; geometry redrawn as SVG primitives).
 */
export function InstagramGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect x={2.75} y={2.75} width={18.5} height={18.5} rx={5.25} fill="none" stroke={color} strokeWidth={2} />
      <Circle cx={12} cy={12} r={4.15} fill="none" stroke={color} strokeWidth={2} />
      <Circle cx={17.45} cy={6.55} r={1.2} fill={color} />
    </Svg>
  );
}
