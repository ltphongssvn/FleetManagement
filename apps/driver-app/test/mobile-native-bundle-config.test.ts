// apps/driver-app/test/mobile-native-bundle-config.test.ts
// TDD: the driver-app Android E2E target is a RELEASE build (assembleRelease),
// not Expo Go. A release build embeds the minified JS bundle in the APK and
// EXCLUDES expo-dev-menu / expo-dev-launcher (debug-only), so there is no
// dev-menu onboarding sheet, no Tools FAB, no ANR, and no Metro dependency.
// The Maestro flow therefore launchApp's the real package id and drives the
// login journey directly. These invariants pin the release-build contract.
//
// Why a release build (Maestro discussion #3041; expo/expo#44234): "Perform a
// Release rather than a Debug build of your application, and it'll stop
// bothering you. As a bonus, your tests will be more representative of what
// your users see." The dev-client path was rejected on the WSL2 software-
// rendered emulator (49-min build, 14-min cold dev-launcher, skipOnboarding not
// surviving pm clear). See context/expo-go-vs-dev-build-vs-release-build-for-
// maestro-e2e.md for the full decision record.
//
// SOURCE-OF-TRUTH RULE (ADR-005): android/ is gitignored (managed-workflow CNG;
// prebuild regenerates it), so EVERY native release setting MUST be asserted
// against its COMMITTED source -- app.json -- NOT against a prebuild-generated
// artifact like android/gradle.properties (absent on a clean CI checkout ->
// ENOENT). app.json expo.updates.enabled=false is what prebuild writes into
// gradle.properties + the AndroidManifest meta-data, so app.json is the
// reproducible source the test must validate.
//
// Verified invariants:
//   1. expo-build-properties enables usesCleartextTraffic so the release build
//      may talk to the api over plain HTTP (Android blocks cleartext in release
//      by default; debug/Expo Go permit it). Without this the login POST fails
//      with "Network request failed" even though TCP connects.
//   2. app.json expo.updates.enabled=false so the release app uses the EMBEDDED
//      bundle and does not run the EAS Update OTA check on launch (which raced
//      the cold start as "New update available..."). Asserted against app.json
//      (committed), not android/gradle.properties (gitignored / prebuild-only).
//   3. The Maestro flow launchApp's the real package id (com.fleetmanagement.
//      driver) and does NOT openLink an exp:// URL (that is the Expo Go model).
//   4. The flow does NOT tap a dev-menu "Continue" button: a release build has
//      no expo-dev-menu, so the onboarding sheet never renders.
//   5. The flow waits for the login SUBTITLE via extendedWaitUntil before
//      interacting (the app still cold-boots; gate on the real mount signal).
//   6. The flow hideKeyboard before submitting (the soft keyboard otherwise
//      occludes the submit button / post-login screen).
//   7. The post-login marker is awaited via extendedWaitUntil (login does a
//      network round-trip then navigates; the home screen is not instant).
//   8. EXPO_PUBLIC_API_URL on the driver-app service is LAN-reachable (not a
//      bare localhost/127.0.0.1) for the Expo Go / web paths that still read it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const composePath = resolve(__dirname, '../../../compose.yaml');
const appJsonPath = resolve(__dirname, '../app.json');
const maestroFlowPath = resolve(__dirname, '../.maestro/driver-login-assignment.yaml');
const compose = readFileSync(composePath, 'utf8');
const appJson = readFileSync(appJsonPath, 'utf8');
const maestroFlow = readFileSync(maestroFlowPath, 'utf8');
interface ExpoConfig {
  expo?: {
    plugins?: unknown[];
    updates?: { enabled?: boolean };
  };
}
const expoCfg = JSON.parse(appJson) as ExpoConfig;
function extractDriverAppBlock(yaml: string): string {
  const m = /^ {2}driver-app:[\s\S]*?(?=\n {0,2}\S|$(?![\s\S]))/m.exec(yaml);
  return m?.[0] ?? '';
}
function appIdLine(flow: string): string {
  const m = /^appId:\s*(\S+)/m.exec(flow);
  return m?.[1] ?? '';
}
describe('driver-app release-build E2E contract', () => {
  it('app.json enables usesCleartextTraffic via expo-build-properties (release HTTP)', () => {
    // Parse plugins and find expo-build-properties android.usesCleartextTraffic.
    const plugins = expoCfg.expo?.plugins ?? [];
    const bp = plugins.find(
      (p): p is [string, { android?: { usesCleartextTraffic?: boolean } }] =>
        Array.isArray(p) && p[0] === 'expo-build-properties',
    );
    expect(bp, 'expo-build-properties plugin must be configured').toBeDefined();
    expect(
      bp?.[1]?.android?.usesCleartextTraffic,
      'android.usesCleartextTraffic must be true so the release APK can reach the api over HTTP',
    ).toBe(true);
  });
  it('app.json disables expo-updates so the release build uses the embedded bundle', () => {
    // ADR-005: assert the COMMITTED source (app.json), not the gitignored
    // prebuild-generated android/gradle.properties. prebuild writes
    // expo.updates.enabled into gradle.properties + the AndroidManifest, so
    // app.json is the reproducible source of truth on a clean CI checkout.
    expect(
      expoCfg.expo?.updates?.enabled,
      'expo.updates.enabled=false avoids the OTA check that races the cold start',
    ).toBe(false);
  });
  it('Maestro flow launchApp the real package id (not Expo Go openLink)', () => {
    expect(appIdLine(maestroFlow), 'appId must be the standalone package').toMatch(
      /^com\.fleetmanagement\.driver$/,
    );
    expect(maestroFlow, 'release flow must launchApp').toMatch(/^- launchApp\b/m);
    expect(maestroFlow, 'release flow must NOT openLink an exp:// URL (Expo Go model)').not.toMatch(
      /openLink:/,
    );
  });
  it('flow does NOT tap a dev-menu Continue button (release has no dev-menu)', () => {
    expect(
      maestroFlow,
      'a release build excludes expo-dev-menu, so there is no onboarding sheet to dismiss',
    ).not.toMatch(/text:\s*["']Continue["']/);
  });
  it('flow waits for the login subtitle via extendedWaitUntil before interacting', () => {
    const ewuBlocks = maestroFlow.match(/extendedWaitUntil:[\s\S]*?(?=\n- |\n*$)/g) ?? [];
    const subtitleWaited = ewuBlocks.some((b) =>
      /visible:\s*["']?Đăng nhập để xem lệnh điều xe/.test(b),
    );
    expect(subtitleWaited, 'subtitle must be guarded by extendedWaitUntil, not a bare assertVisible').toBe(true);
  });
  it('flow hides the keyboard before submitting login', () => {
    expect(maestroFlow, 'flow must hideKeyboard so the keyboard does not occlude submit / post-login screen').toMatch(/hideKeyboard/);
  });
  it('post-login marker is awaited via extendedWaitUntil (not a bare assert)', () => {
    const ewuBlocks = maestroFlow.match(/extendedWaitUntil:[\s\S]*?(?=\n- |\n*$)/g) ?? [];
    const syncWaited = ewuBlocks.some((b) => /visible:\s*["']?Trạng thái đồng bộ/.test(b));
    expect(syncWaited, 'post-login Trạng thái đồng bộ must be awaited via extendedWaitUntil').toBe(true);
  });
  it('EXPO_PUBLIC_API_URL on driver-app is LAN-reachable (not localhost / 127.0.0.1)', () => {
    const block = extractDriverAppBlock(compose);
    const m = /EXPO_PUBLIC_API_URL:\s*(\S+)/.exec(block);
    expect(m, 'EXPO_PUBLIC_API_URL must be declared on driver-app service').not.toBeNull();
    const url = m?.[1] ?? '';
    expect(url).not.toMatch(/localhost/);
    expect(url).not.toMatch(/127\.0\.0\.1/);
  });
});
