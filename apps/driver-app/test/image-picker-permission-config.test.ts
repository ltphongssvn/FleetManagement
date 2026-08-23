// apps/driver-app/test/image-picker-permission-config.test.ts
// outside-in strict TDD (L1 config): the camera permission prompt the driver
// sees must be in Vietnamese. The native rationale is configured via the
// expo-image-picker config plugin, and Vietnamese must be a supported native
// locale so the iOS system permission dialog is localized in release builds.
//
// Locales placement (the cross-platform contract, settled 2026-06-12):
// - app.json declares locales at the TOP LEVEL (expo.locales) -- the only
//   schema-valid placement; expo.ios.locales fails expo-doctor with
//   "ios - should NOT have additional property 'locales'".
// - The locale FILE nests platform-specific strings under 'ios'/'android'
//   keys (current app-config schema). A FLAT locale file with bare NS* keys
//   is what makes a top-level locales emit orphan Android string resources
//   (values-b+vi) and fail lintVitalRelease with ExtraTranslation
//   (expo/expo#38860, #40200). Nesting under 'ios' satisfies BOTH the
//   expo-doctor schema and the Android lint constraint simultaneously.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
interface PluginEntry {
  0: string;
  1?: Record<string, unknown>;
}
interface AppJson {
  expo: {
    plugins: (string | PluginEntry)[];
    locales?: Record<string, string>;
    ios?: Record<string, unknown>;
  };
}
interface ViLocale {
  ios?: Record<string, string>;
  android?: Record<string, string>;
  [key: string]: unknown;
}
const app = JSON.parse(readFileSync(resolve(__dirname, '../app.json'), 'utf8')) as AppJson;
const viLocale = JSON.parse(
  readFileSync(resolve(__dirname, '../locales/vi.json'), 'utf8'),
) as ViLocale;
function findPlugin(name: string): PluginEntry | undefined {
  for (const p of app.expo.plugins) {
    if (Array.isArray(p) && p[0] === name) return p as unknown as PluginEntry;
  }
  return undefined;
}
// Vietnamese must contain diacritics (e.g. ả, ụ, ấ) -- a plain-ASCII string
// would betray an un-translated/placeholder value.
const VN_DIACRITICS = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i;
describe('@fleet/driver-app - expo-image-picker camera permission localization', () => {
  it('declares the expo-image-picker config plugin', () => {
    expect(
      findPlugin('expo-image-picker'),
      'expo-image-picker must be a configured plugin',
    ).toBeDefined();
  });
  it('sets a Vietnamese cameraPermission rationale string', () => {
    const plugin = findPlugin('expo-image-picker');
    const opts = plugin?.[1] ?? {};
    const cam = opts['cameraPermission'];
    expect(typeof cam, 'cameraPermission must be a string').toBe('string');
    expect(cam as string).toMatch(VN_DIACRITICS);
  });
  it('declares Vietnamese (vi) at the schema-valid TOP-LEVEL expo.locales', () => {
    expect(app.expo.locales, 'expo.locales (top level) must be declared').toBeDefined();
    expect(Object.keys(app.expo.locales ?? {})).toContain('vi');
  });
  it('does NOT place locales under expo.ios (expo-doctor schema violation)', () => {
    expect(
      app.expo.ios?.['locales'],
      'expo.ios.locales is not a valid schema property and fails expo-doctor',
    ).toBeUndefined();
  });
  it('nests iOS NS* purpose strings under the ios key in the locale file', () => {
    const ios = viLocale.ios ?? {};
    const cam = ios['NSCameraUsageDescription'];
    if (typeof cam !== 'string')
      throw new Error('locales/vi.json must nest NSCameraUsageDescription under ios');
    expect(cam).toMatch(VN_DIACRITICS);
  });
  it('keeps the locale file free of bare top-level NS* keys (Android ExtraTranslation trigger)', () => {
    const bareNsKeys = Object.keys(viLocale).filter((k) => k.startsWith('NS'));
    expect(
      bareNsKeys,
      'flat NS* keys at the locale-file top level emit orphan values-b+vi Android resources',
    ).toEqual([]);
  });
});
