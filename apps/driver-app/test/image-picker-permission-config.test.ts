// apps/driver-app/test/image-picker-permission-config.test.ts
// outside-in strict TDD RED (L1 config): the camera permission prompt the
// driver sees must be in Vietnamese, not English. Drivers are local and do not
// read English, so the native camera-permission rationale (shown by
// expo-image-picker / the OS when Chụp ảnh is tapped) must be a Vietnamese
// string configured via the expo-image-picker config plugin, and the app must
// declare Vietnamese as a supported native locale so the system permission
// dialog is localized in production builds.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
interface PluginEntry { 0: string; 1?: Record<string, unknown> }
interface AppJson {
  expo: {
    plugins: (string | PluginEntry)[];
    ios?: {
      infoPlist?: Record<string, unknown>;
      locales?: Record<string, string | Record<string, string>>;
    };
  };
}
const app = JSON.parse(readFileSync(resolve(__dirname, '../app.json'), 'utf8')) as AppJson;
function findPlugin(name: string): PluginEntry | undefined {
  for (const p of app.expo.plugins) {
    if (Array.isArray(p) && p[0] === name) return p as unknown as PluginEntry;
  }
  return undefined;
}
// Vietnamese must contain diacritics (e.g. ả, ụ, ấ) — a plain-ASCII string
// would betray an un-translated/placeholder value.
const VN_DIACRITICS = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i;
describe('@fleet/driver-app - expo-image-picker camera permission localization', () => {
  it('declares the expo-image-picker config plugin', () => {
    expect(findPlugin('expo-image-picker'), 'expo-image-picker must be a configured plugin').toBeDefined();
  });
  it('sets a Vietnamese cameraPermission rationale string', () => {
    const plugin = findPlugin('expo-image-picker');
    const opts = plugin?.[1] ?? {};
    const cam = opts['cameraPermission'];
    expect(typeof cam, 'cameraPermission must be a string').toBe('string');
    expect(cam as string).toMatch(VN_DIACRITICS);
  });
  it('declares Vietnamese (vi) as a supported iOS native locale', () => {
    // locales is scoped under ios: the NS* purpose strings localize the iOS
    // system permission dialog. A top-level locales additionally emits orphan
    // Android string resources (values-b+vi) with no base entry, failing
    // lintVitalRelease with ExtraTranslation (expo/expo#38860, #40200). See
    // docs/adr/005-android-e2e-release-build.md.
    expect(app.expo.ios?.locales, 'expo.ios.locales must be declared').toBeDefined();
    expect(Object.keys(app.expo.ios?.locales ?? {})).toContain('vi');
  });
});
