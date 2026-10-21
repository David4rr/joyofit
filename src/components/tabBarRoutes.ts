/**
 * Which tab the bar marks as current. Pure, so the mapping is unit tested.
 *
 * "More" (`settings`, the Settings stack: Watch section first, then the settings) is the tab for everything that is not Today,
 * Workouts or Social. Screens that are hidden tabs but are reached from it (the Watch hub and the watch's routes, Family, the
 * Today cards editor) keep it marked instead of leaving the bar with no current tab.
 */

/** The route name of the "More" tab. It is the Settings stack, so `/settings` and every `/settings/*` link keep working. */
export const MORE_ROUTE = 'settings';

/** Hidden tab routes that belong under "More": opened from its Watch section or its settings rows. */
const MORE_CHILD_ROUTES: Record<string, true> = { watch: true, routes: true, family: true, 'home-cards': true };

/** True when `routeName` is the tab to mark current while `focusedRoute` is the route on screen. */
export function isTabCurrent(routeName: string, focusedRoute: string): boolean {
  if (routeName === focusedRoute) return true;
  return routeName === MORE_ROUTE && Object.hasOwn(MORE_CHILD_ROUTES, focusedRoute);
}
