// apps/driver-app/app.config.ts
// Dynamic Expo config (driver-app-ota arc, Phases 2+3). Extends the static
// app.json base and overrides ONLY the OTA-relevant fields, so every existing
// declaration (plugins, ios/android, networkSecurityConfig from the security
// arc) stays declarative in app.json and keeps passing its guard.
//
// EAS Update activation is PER-PROFILE, keyed on EAS_BUILD_PROFILE (injected by
// EAS at build time):
//   - preview / production  -> updates.enabled = true  (the 100 drivers get OTA
//     JS/asset updates on next launch; no reinstall).
//   - e2e / development / (unset/unknown) -> updates.enabled = false. The
//     Maestro release E2E build (--profile e2e) stays on the embedded bundle +
//     localhost API so the deterministic emulator run is never raced by an OTA
//     check. Fail-safe default: an un-profiled build does NOT silently OTA.
//
// runtimeVersion.policy = fingerprint makes the JS<->native contract match the
// build-layer fingerprint gating already shipped (PR #264), so SDK 55 auto-
// decides OTA-vs-rebuild. fallbackToCacheTimeout = 0 (kept from app.json) keeps
// startup NON-blocking: launch on the embedded bundle, apply any downloaded
// update on the NEXT launch -- which is why enabling OTA does not reintroduce
// the cold-start race the blunt enabled:false originally avoided.
import type { ConfigContext, ExpoConfig } from 'expo/config';

const OTA_ENABLED_PROFILES = new Set(['preview', 'production']);

export default ({ config }: ConfigContext): ExpoConfig => {
  const profile = process.env['EAS_BUILD_PROFILE'] ?? '';
  const otaEnabled = OTA_ENABLED_PROFILES.has(profile);

  // config is the static app.json (expo key already unwrapped by Expo). Spread
  // it first, then override only the OTA fields so nothing else is lost.
  const base = config as Partial<ExpoConfig>;
  const baseUpdates = (base.updates ?? {}) as Record<string, unknown>;

  return {
    ...(base as ExpoConfig),
    // name/slug are required by the ExpoConfig type; fall back to the known
    // static values so the type is satisfied even if config is passed empty.
    name: base.name ?? 'Fleet Driver',
    slug: base.slug ?? 'fleet-driver',
    updates: {
      ...baseUpdates,
      enabled: otaEnabled,
      fallbackToCacheTimeout: 0,
    },
    runtimeVersion: { policy: 'fingerprint' },
  };
};
