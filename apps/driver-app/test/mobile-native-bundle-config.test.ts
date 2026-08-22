// apps/driver-app/test/mobile-native-bundle-config.test.ts
// TDD: the driver-app Android E2E target is a RELEASE build (assembleRelease),
// not Expo Go. A release build embeds the minified JS bundle in the APK and
// EXCLUDES expo-dev-menu / expo-dev-launcher (debug-only), so there is no
// dev-menu onboarding sheet, no Tools FAB, no ANR, and no Metro dependency.
// The Maestro flow therefore launchApp's the real package id and drives the
// login journey directly. These invariants pin the release-build contract.
//
// SOURCE-OF-TRUTH RULE (ADR-005): android/ is gitignored (managed-workflow CNG;
// prebuild regenerates it), so EVERY native release setting MUST be asserted
// against its COMMITTED source -- app.json + committed plugin files -- NOT
// against a prebuild-generated artifact like android/gradle.properties (absent
// on a clean CI checkout -> ENOENT).
//
// NETWORK SECURITY (Phase 5, driver-app-security arc): the former global
// android.usesCleartextTraffic:true is a MASVS-NETWORK finding (MASTG-TEST-0235)
// AND an active HTTPS hazard -- a global cleartext base-config without explicit
// trust-anchors overrode the system CA store, breaking HTTPS to the production
// host on device. Replaced with a committed, DOMAIN-SCOPED network security
// config wired via expo-build-properties.android.networkSecurityConfig:
//   - base-config cleartextTrafficPermitted=false WITH system trust-anchors
//     (production HTTPS to xe.vominhchau.com keeps full CA trust);
//   - domain-config cleartextTrafficPermitted=true scoped ONLY to the E2E hosts
//     (10.0.2.2 emulator loopback, localhost, 127.0.0.1) so the Maestro release
//     flow can still reach the api over adb-reversed HTTP.
// This test is the permanent regression guard against production cleartext drift.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { OTA_ENABLED_ENVS, resolveAppEnv } from '../app.config';
const composePath = resolve(__dirname, '../../../compose.yaml');
const appJsonPath = resolve(__dirname, '../app.json');
const nscPath = resolve(__dirname, '../plugins/network_security_config.xml');
const maestroFlowPath = resolve(__dirname, '../.maestro/driver-login-assignment.yaml');
const compose = readFileSync(composePath, 'utf8');
const appJson = readFileSync(appJsonPath, 'utf8');
const maestroFlow = readFileSync(maestroFlowPath, 'utf8');
// app.json is FILE INPUT -- a trust boundary -- so it is Zod-parsed rather than
// cast through a hand-written interface, and the TYPE derives from the schema.
const ExpoAppJsonSchema = z.object({
  expo: z
    .object({
      plugins: z.array(z.unknown()).optional(),
      updates: z.object({ enabled: z.boolean().optional() }).loose().optional(),
    })
    .loose()
    .optional(),
});
type ExpoAppJson = z.infer<typeof ExpoAppJsonSchema>;
const expoCfg: ExpoAppJson = ExpoAppJsonSchema.parse(JSON.parse(appJson));
function buildPropsAndroid(cfg: ExpoAppJson): Record<string, unknown> | undefined {
  const plugins = cfg.expo?.plugins ?? [];
  const bp = plugins.find(
    (p): p is [string, { android?: Record<string, unknown> }] =>
      Array.isArray(p) && p[0] === 'expo-build-properties',
  );
  return bp?.[1]?.android;
}
function extractDriverAppBlock(yaml: string): string {
  const m = /^ {2}driver-app:[\s\S]*?(?=\n {0,2}\S|$(?![\s\S]))/m.exec(yaml);
  return m?.[0] ?? '';
}
function appIdLine(flow: string): string {
  const m = /^appId:\s*(\S+)/m.exec(flow);
  return m?.[1] ?? '';
}
describe('driver-app release-build E2E contract', () => {
  it('app.json does NOT set a global usesCleartextTraffic (production cleartext drift guard)', () => {
    const android = buildPropsAndroid(expoCfg);
    expect(android, 'expo-build-properties android block must exist').toBeDefined();
    expect(
      android?.['usesCleartextTraffic'],
      'global android.usesCleartextTraffic must be absent -- cleartext is domain-scoped via networkSecurityConfig',
    ).toBeUndefined();
  });
  it('app.json wires a committed networkSecurityConfig via expo-build-properties', () => {
    const android = buildPropsAndroid(expoCfg);
    expect(
      android?.['networkSecurityConfig'],
      'android.networkSecurityConfig must point at the committed XML',
    ).toBe('./plugins/network_security_config.xml');
  });
  it('the network security config forbids cleartext in base-config but keeps system trust-anchors (HTTPS intact)', () => {
    const nsc = readFileSync(nscPath, 'utf8');
    const baseMatch = /<base-config[\s\S]*?<\/base-config>/.exec(nsc);
    expect(baseMatch, 'a base-config block must exist').not.toBeNull();
    const base = baseMatch?.[0] ?? '';
    expect(base, 'base-config must forbid cleartext in production').toMatch(
      /cleartextTrafficPermitted\s*=\s*["']false["']/,
    );
    expect(base, 'base-config must keep the system CA trust-anchor so HTTPS still validates').toMatch(
      /<certificates\s+src\s*=\s*["']system["']/,
    );
  });
  it('the network security config scopes cleartext to the E2E hosts ONLY', () => {
    const nsc = readFileSync(nscPath, 'utf8');
    const domMatch = /<domain-config[\s\S]*?<\/domain-config>/.exec(nsc);
    expect(domMatch, 'a domain-config block must exist for the E2E hosts').not.toBeNull();
    const dom = domMatch?.[0] ?? '';
    expect(dom, 'domain-config permits cleartext for the dev hosts').toMatch(
      /cleartextTrafficPermitted\s*=\s*["']true["']/,
    );
    expect(dom).toMatch(/<domain[^>]*>\s*10\.0\.2\.2\s*<\/domain>/);
    expect(dom).toMatch(/<domain[^>]*>\s*localhost\s*<\/domain>/);
    expect(dom).toMatch(/<domain[^>]*>\s*127\.0\.0\.1\s*<\/domain>/);
    // Production host must NOT appear as a cleartext domain.
    expect(dom, 'the production host must never be a cleartext domain').not.toMatch(/xe\.vominhchau\.com/);
  });
  // WAS: asserted the STATIC app.json flag `updates.enabled === false`. That
  // flag is gone -- app.config.ts now decides per APP_ENV, because the drivers'
  // preview APKs MUST receive OTA (22 sideloaded installs cannot be re-installed
  // by hand) while E2E binaries must not change under the harness.
  //
  // The contract this test protects is unchanged: the binary Maestro drives uses
  // the EMBEDDED bundle. It is now asserted against the RESOLVER for the E2E
  // env rather than a file constant -- the stronger claim, since that is what
  // the build actually reads.
  //
  // The original rationale ("avoids the OTA check that races the cold start")
  // was over-broad: fallbackToCacheTimeout:0 already prevents that race by never
  // blocking launch on the network. Disabling updates outright was a blunt
  // instrument, and it disabled the drivers' only delivery channel too.
  it('the E2E build resolves to updates DISABLED, so Maestro drives the embedded bundle', () => {
    expect(OTA_ENABLED_ENVS).not.toContain(resolveAppEnv('e2e'));
    expect(OTA_ENABLED_ENVS).not.toContain(resolveAppEnv(undefined));
  });

  it('app.json no longer hardcodes enablement -- app.config.ts is the only decider', () => {
    expect(expoCfg.expo?.updates).not.toHaveProperty('enabled');
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
