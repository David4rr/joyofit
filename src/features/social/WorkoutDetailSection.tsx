import { useCallback, useMemo } from 'react';

import { rogo } from '@/cloud/rogo';
import { Section } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { ProUpsell } from '@/features/social/ProUpsell';
import { hrChartProps, routeViewPoints } from '@/features/social/detailAdapter';
import { useRogoQuery } from '@/features/social/useRogoQuery';
import { HeartRateChart } from '@/features/workouts/HeartRateChart';
import { RouteView } from '@/features/workouts/RouteView';

/**
 * The heart-rate chart and the route of a watch post (`stats.hasDetail === 1`). JoyoRogo decides who sees them: the author
 * and Pro viewers get the data, everyone else `locked` and the Pro upsell.
 */
export function WorkoutDetailSection({ postId, startedAt }: { postId: string; startedAt: number }) {
  const load = useCallback(() => rogo.social.workoutDetail(postId), [postId]);
  const { data, error } = useRogoQuery(load, true);
  const chart = useMemo(() => (data?.hr ? hrChartProps(data.hr, startedAt / 1000) : null), [data, startedAt]);
  const route = useMemo(() => (data?.route ? routeViewPoints(data.route) : null), [data]);

  if (!data) {
    return error !== null ? <Notice tone="danger">{error}</Notice> : <Skeleton width="100%" height={200} radius="card" />;
  }
  if (data.locked) return <ProUpsell />;
  return (
    <>
      {chart ? (
        <Section title="Heart rate" icon="heart" tint="heart">
          <HeartRateChart {...chart} />
        </Section>
      ) : null}
      {route ? (
        <Section title="Route" icon="map" tint="workouts">
          <RouteView route={route} />
        </Section>
      ) : null}
    </>
  );
}
