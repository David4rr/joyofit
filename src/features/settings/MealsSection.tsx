import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { CLOUD_CONFIGURED } from '@/cloud/config';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { formatDateTime } from '@/format';
import { useMeals } from '@/state/MealsProvider';

/** The "Meals on watch" card: what JoyoFit last read from JoyoRogo and last pushed to the watch's calorie card. */
export function MealsSection() {
  const { t } = useTranslation('settings');
  const meals = useMeals();
  const { diet } = meals;
  useNativeRefresh(meals.reloadStatus);

  const supported = diet.supported;
  const support = supported
    ? [
        supported.config ? t('meals.support.goals') : null,
        supported.point ? t('meals.support.meals') : null,
        supported.dictionary ? t('meals.support.weight') : null,
        supported.event ? t('meals.support.requests') : null,
        supported.extraMealSlots ? t('meals.support.extraSlots') : null,
      ]
        .filter(Boolean)
        .join(', ')
    : null;

  return (
    <Section title={t('meals.title')} icon="restaurant">
      <PairGrid>
        <Pair label="JoyoRogo" value={meals.signedIn
              ? t('meals.signedIn')
              : CLOUD_CONFIGURED
                ? t('meals.notSignedIn')
                : t('meals.notSignedInCloudOff')} />
        <Pair label={t('meals.day')} value={diet.date} />
        <Pair
          label={t('meals.mealsLabel')}
          wide
          value={
            diet.mealCount === null
              ? null
              : diet.goals
                ? t('meals.mealsValueGoal', {
                    count: diet.mealCount,
                    kcal: Math.round(diet.intakeKcal ?? 0),
                    goal: diet.goals.dailyKcal,
                  })
                : t('meals.mealsValue', { count: diet.mealCount, kcal: Math.round(diet.intakeKcal ?? 0) })
          }
        />
        <Pair label={t('meals.lastRead')} value={meals.lastRefreshAt ? formatDateTime(meals.lastRefreshAt / 1000) : null} />
        <Pair label={t('meals.lastPush')} value={diet.pushedAt ? formatDateTime(diet.pushedAt / 1000) : null} />
        <Pair label={t('meals.lastResult')} value={diet.lastResult} wide />
        <Pair label={t('meals.accepts')} value={support === null ? t('meals.notConnected') : support || t('meals.nothing')} wide />
      </PairGrid>
      {diet.unsyncedWatchMeals ? (
        <Notice>
          {t('meals.unsynced', { count: diet.unsyncedWatchMeals })}
        </Notice>
      ) : null}
      {meals.lastRefreshNote ? (
        <AppText variant="caption" muted>
          {meals.lastRefreshNote}
        </AppText>
      ) : null}
      {meals.error ? <Notice tone="danger">{meals.error}</Notice> : null}
      <Button label={t('meals.pushNow')} variant="primary" icon="send" loading={meals.refreshing} onPress={() => void meals.pushNow()} />
      <Details>{t('meals.details')}</Details>
    </Section>
  );
}
