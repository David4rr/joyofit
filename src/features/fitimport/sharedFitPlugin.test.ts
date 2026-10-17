import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { applySharedFit } from '../../../plugins/with-shared-fit';

/** The MainActivity of Expo's template, as `expo prebuild` writes it for this app. */
const TEMPLATE = `package com.joyodigitama.joyofit
import expo.modules.splashscreen.SplashScreenManager

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // @generated end expo-splashscreen
    super.onCreate(null)
  }
}
`;

describe('with-shared-fit plugin', () => {
  it('turns a shared file into a view intent, at launch and on a new intent', () => {
    const out = applySharedFit(TEMPLATE);
    expect(out).toContain('override fun onNewIntent(intent: android.content.Intent)');
    expect(out).toMatch(/viewSharedFile\(intent\)\n\s*super\.onCreate\(null\)/);
    expect(out).toMatch(/viewSharedFile\(intent\)\n\s*super\.onNewIntent\(intent\)/);
    expect(out).toContain('intent.data = stream');
  });

  it('is idempotent', () => {
    const once = applySharedFit(TEMPLATE);
    expect(applySharedFit(once)).toBe(once);
  });

  it('refuses a MainActivity it does not recognize instead of silently dropping shared files', () => {
    expect(() => applySharedFit('class Other {}')).toThrow('MainActivity layout changed');
  });

  it('is registered in app.json with the intent filters for .fit files', () => {
    const { expo } = JSON.parse(readFileSync('app.json', 'utf8'));
    expect(expo.plugins).toContain('./plugins/with-shared-fit');
    const actions = expo.android.intentFilters.map((f: { action: string }) => f.action);
    expect(actions).toEqual(['VIEW', 'VIEW', 'VIEW', 'SEND']);
    expect(JSON.stringify(expo.android.intentFilters)).toContain('application/vnd.ant.fit');
  });
});
