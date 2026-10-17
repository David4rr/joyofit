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

  it('is registered in app.json with the intent filters for .fit, .zip, .gpx and .tcx files', () => {
    const { expo } = JSON.parse(readFileSync('app.json', 'utf8'));
    expect(expo.plugins).toContain('./plugins/with-shared-fit');
    const actions = expo.android.intentFilters.map((f: { action: string }) => f.action);
    expect(actions).toEqual(['VIEW', 'VIEW', 'VIEW', 'VIEW', 'VIEW', 'VIEW', 'VIEW', 'VIEW', 'VIEW', 'SEND']);
    const filters = JSON.stringify(expo.android.intentFilters);
    expect(filters).toContain('application/vnd.ant.fit');
    expect(filters).toContain('application/x-zip-compressed');
    expect(filters).toContain('application/gpx+xml');
    expect(filters).toContain('application/vnd.garmin.tcx+xml');
    expect(filters).toContain('.*\\\\\\\\.gpx');
    expect(filters).toContain('.*\\\\\\\\.TCX');
    const send = expo.android.intentFilters.find((f: { action: string }) => f.action === 'SEND');
    const sendTypes = send.data.map((d: { mimeType: string }) => d.mimeType);
    expect(sendTypes).toEqual(expect.arrayContaining(['application/gpx+xml', 'application/vnd.garmin.tcx+xml', 'application/xml', 'text/xml']));
  });

  it('declares the gpx and tcx document types for iOS', () => {
    const { expo } = JSON.parse(readFileSync('app.json', 'utf8'));
    const types = expo.ios.infoPlist.UTImportedTypeDeclarations;
    const byId = Object.fromEntries(types.map((t: { UTTypeIdentifier: string }) => [t.UTTypeIdentifier, t]));
    expect(byId['com.joyodigitama.joyofit.gpx'].UTTypeConformsTo).toEqual(['public.xml']);
    expect(byId['com.joyodigitama.joyofit.gpx'].UTTypeTagSpecification['public.filename-extension']).toEqual(['gpx']);
    expect(byId['com.joyodigitama.joyofit.tcx'].UTTypeTagSpecification['public.mime-type']).toEqual(['application/vnd.garmin.tcx+xml']);
    const documents = expo.ios.infoPlist.CFBundleDocumentTypes.flatMap((d: { LSItemContentTypes: string[] }) => d.LSItemContentTypes);
    expect(documents).toEqual(['com.joyodigitama.joyofit.fit', 'com.joyodigitama.joyofit.gpx', 'com.joyodigitama.joyofit.tcx']);
  });
});
