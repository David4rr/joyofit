import { CASING_WIDTH, LINE_WIDTH, MAP_INK } from '@/features/routes/map/mapConfig';
import type { MapLibre } from '@/features/routes/map/maplibre';

interface RouteLayersProps {
  maplibre: MapLibre;
  color: string;
  /** The line: a white casing under a colored line. */
  line: GeoJSON.FeatureCollection;
  /** Legs still being asked from the routing service: the straight segment, dashed. */
  pending?: GeoJSON.FeatureCollection;
  /** Waypoints between the start and the end: small dots. */
  via?: GeoJSON.FeatureCollection;
  /** Filled dot. */
  start?: GeoJSON.FeatureCollection;
  /** Ring. */
  end?: GeoJSON.FeatureCollection;
}

/** The route as map layers, drawn in this order (later is on top). Source and layer ids are fixed: MapLibre freezes them. */
export function RouteLayers({ maplibre, color, line, pending, via, start, end }: RouteLayersProps) {
  const { GeoJSONSource, Layer } = maplibre;
  const roundLine = { 'line-cap': 'round', 'line-join': 'round' } as const;
  return (
    <>
      <GeoJSONSource id="route-line" data={line}>
        <Layer
          id="route-casing"
          type="line"
          layout={roundLine}
          paint={{ 'line-color': MAP_INK.casing, 'line-width': CASING_WIDTH, 'line-opacity': 0.9 }}
        />
        <Layer id="route-stroke" type="line" layout={roundLine} paint={{ 'line-color': color, 'line-width': LINE_WIDTH }} />
      </GeoJSONSource>
      {pending ? (
        <GeoJSONSource id="route-pending" data={pending}>
          <Layer
            id="route-pending-stroke"
            type="line"
            paint={{ 'line-color': color, 'line-width': LINE_WIDTH - 1, 'line-dasharray': [1.5, 1.5], 'line-opacity': 0.8 }}
          />
        </GeoJSONSource>
      ) : null}
      {via ? (
        <GeoJSONSource id="route-via" data={via}>
          <Layer
            id="route-via-dot"
            type="circle"
            paint={{ 'circle-radius': 4, 'circle-color': MAP_INK.casing, 'circle-stroke-width': 2, 'circle-stroke-color': color }}
          />
        </GeoJSONSource>
      ) : null}
      {start ? (
        <GeoJSONSource id="route-start" data={start}>
          <Layer
            id="route-start-dot"
            type="circle"
            paint={{ 'circle-radius': 7, 'circle-color': color, 'circle-stroke-width': 2, 'circle-stroke-color': MAP_INK.casing }}
          />
        </GeoJSONSource>
      ) : null}
      {end ? (
        <GeoJSONSource id="route-end" data={end}>
          <Layer
            id="route-end-ring"
            type="circle"
            paint={{ 'circle-radius': 7, 'circle-color': MAP_INK.casing, 'circle-stroke-width': 3, 'circle-stroke-color': color }}
          />
        </GeoJSONSource>
      ) : null}
    </>
  );
}
