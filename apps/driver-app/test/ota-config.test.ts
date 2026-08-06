// apps/driver-app/test/ota-config.test.ts
// RED (driver-app-ota arc, Phases 2+3): EAS Update activation contract.
// The driver app must receive OTA JS/asset updates so 100 drivers get daily
// features on next launch without reinstalling. Enablement is PER-PROFILE via
// app.config.ts keyed on EAS_BUILD_PROFILE:
//   - preview / production  -> updates.enabled = true  (drivers get OTA)
//   - e2e / development      -> updates.enabled = false (Maestro release E2E
//     stays on the embedded bundle + localhost API; no OTA check races the
//     deterministic emulator run).
// runtimeVersion.policy = fingerprint aligns the JS<->native contract with the
// build-layer fingerprint gating already shipped (PR #264), so SDK 55 auto-
// decides OTA-vs-rebuild. fallbackToCacheTimeout = 0 keeps startup NON-blocking
// (launch on embedded bundle, apply any update next launch) -- which is why
// enabling OTA does not reintroduce the cold-start race the blunt
// enabled:false originally avoided.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// app.config.ts is a dynamic Expo config: a function of the ambient
// EAS_BUILD_PROFILE. Re-import fresh per case (house pattern: vi.resetModules()
// + plain relative import, mirroring token-storage.test.ts) so the env is read
// at call time. The Expo config contract is default-export a function that
// receives { config } (the static app.json base) and returns the merged config.
async function loadConfig(profile: string | undefined): Promise<Record<string, unknown>> {
  const prev = process.env['EAS_BUILD_PROFILE'];
  if (profile === undefined) delete process.env['EAS_BUILD_PROFILE'];
  else process.env['EAS_BUILD_PROFILE'] = profile;
  try {
    vi.resetModules();
    // Mirror Expo's contract: it parses app.json and passes its expo block as
    // ctx.config. Load the real static base so base-preservation + url/projectId
    // assertions exercise the actual merge, not an empty stub.
    const appJson = JSON.parse(readFileSync(resolve(__dirname, '../app.json'), 'utf8')) as { expo: Record<string, unknown> };
    const mod = await import('../app.config.js');
    const factory = (mod as { default: (ctx: { config: Record<string, unknown> }) => Record<string, unknown> }).default;
    return { expo: factory({ config: appJson.expo }) };
  } finally {
    if (prev === undefined) delete process.env['EAS_BUILD_PROFILE'];
    else process.env['EAS_BUILD_PROFILE'] = prev;
  }
}

interface UpdatesShape { enabled?: boolean; url?: string; fallbackToCacheTimeout?: number }
interface RuntimeShape { policy?: string }
function expoOf(cfg: Record<string, unknown>): {
  updates?: UpdatesShape;
  runtimeVersion?: RuntimeShape;
  extra?: { eas?: { projectId?: string } };
} {
  return (cfg as { expo?: Record<string, unknown> }).expo as never;
}

afterEach(() => { /* env restored inside loadConfig */ });

describe('app.config.ts OTA activation', () => {
  it('uses the fingerprint runtime version policy (aligns with build fingerprint gating)', async () => {
    const expo = expoOf(await loadConfig('production'));
    expect(expo.runtimeVersion?.policy).toBe('fingerprint');
  });

  it('enables OTA updates for the production profile', async () => {
    const expo = expoOf(await loadConfig('production'));
    expect(expo.updates?.enabled).toBe(true);
  });

  it('enables OTA updates for the preview profile (the profile drivers install)', async () => {
    const expo = expoOf(await loadConfig('preview'));
    expect(expo.updates?.enabled).toBe(true);
  });

  it('DISABLES OTA for the e2e profile (Maestro release build stays on embedded bundle)', async () => {
    const expo = expoOf(await loadConfig('e2e'));
    expect(expo.updates?.enabled).toBe(false);
  });

  it('DISABLES OTA for the development profile', async () => {
    const expo = expoOf(await loadConfig('development'));
    expect(expo.updates?.enabled).toBe(false);
  });

  it('keeps startup non-blocking: fallbackToCacheTimeout is 0 regardless of profile', async () => {
    const expo = expoOf(await loadConfig('production'));
    expect(expo.updates?.fallbackToCacheTimeout).toBe(0);
  });

  it('keeps the updates URL and eas projectId consistent (same project)', async () => {
    const expo = expoOf(await loadConfig('production'));
    const projectId = expo.extra?.eas?.projectId ?? '';
    expect(expo.updates?.url).toBeDefined();
    expect(projectId.length).toBeGreaterThan(0);
    expect(expo.updates?.url).toContain(projectId);
  });

  it('preserves the static base config (name, slug, plugins) through the dynamic layer', async () => {
    const cfg = await loadConfig('production');
    const expo = (cfg as { expo?: Record<string, unknown> }).expo ?? {};
    expect(expo['slug']).toBe('fleet-driver');
    expect(Array.isArray(expo['plugins'])).toBe(true);
  });
});
