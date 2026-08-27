// apps/driver-app/app.config.ts
// DYNAMIC Expo config: decides, per build profile, whether this binary receives
// over-the-air updates.
//
// THE PROBLEM THIS SOLVES. 22 drivers run sideloaded preview APKs. Shipping a
// fix by rebuilding and asking all 22 to re-install is not an option, so EAS
// Update is the delivery mechanism. Everything for it was already wired --
// expo-updates installed, updates.url and extra.eas.projectId pointing at the
// real project, three channels in eas.json -- except app.json carried
// `updates.enabled: false`, which switches the whole mechanism off. One flag
// was the entire gap between "OTA is configured" and "OTA works".
//
// WHY A DYNAMIC CONFIG RATHER THAN FLIPPING THE FLAG. The E2E harness
// (scripts/e2e/driver-maestro.mts) does NOT build; it runs Maestro flows
// against an APK already installed on the emulator, launching the app several
// times across four flows. expo-updates checks on launch and applies on the
// NEXT launch, so an update published to the channel that E2E's APK subscribes
// to could change behaviour BETWEEN flows -- a non-deterministic suite whose
// failures look like app bugs. Drivers and E2E therefore need different
// answers, and app.json is static, so the answer has to be computed.
//
// APP_ENV is already set per profile in eas.json, so it is the natural key.
// Expo reads app.json FIRST and hands it to this function as `config`; we
// override only the updates block and leave every other field alone.
//
// runtimeVersion.policy stays "appVersion", NOT fingerprint. Expo's own docs
// (2026) still call the fingerprint policy "experimental and not yet widely
// recommended", and their guidance is appVersion as the POLICY with
// fingerprinting used as a CI DETECTION tool -- which this repo already has in
// //#eas:freshness (scripts/eas-build-freshness.ts). Switching the policy would
// swap Expo's recommended arrangement for its experimental one and change the
// runtime version of every existing install, orphaning the very binaries the
// drivers are running.
import type { ExpoConfig, ConfigContext } from 'expo/config';
import { z } from 'zod';

/** The build-profile vocabulary -- the SINGLE definition.
 *
 *  Canonical SSOT enum pattern (packages/domain/.../manifest-rejection-reason.ts):
 *  one frozen as-const array; the TYPE and the SCHEMA both DERIVE from it, so a
 *  new profile cannot be added to one and forgotten in the other. The strings
 *  also appear in eas.json as APP_ENV values, and eas-config.test.ts asserts
 *  the two agree rather than restating the list a third time. */
export const APP_ENVS = Object.freeze(['development', 'preview', 'production', 'e2e'] as const);
export type AppEnv = (typeof APP_ENVS)[number];
export const AppEnvSchema = z.enum(APP_ENVS);

/** Profiles whose binaries SHOULD receive OTA updates. Derived from the
 *  vocabulary above, never a parallel list of loose strings.
 *
 *  preview is on it because that is what the drivers actually run: eas.json
 *  builds preview as an APK for internal distribution, while production emits
 *  an app-bundle for the store. e2e and development are excluded so test and
 *  dev binaries stay byte-stable for the run. */
export const OTA_ENABLED_ENVS: readonly AppEnv[] = Object.freeze(
  APP_ENVS.filter((e): e is AppEnv => e === 'preview' || e === 'production'),
);

/** Read APP_ENV at the TRUST BOUNDARY.
 *
 *  process.env is untyped external input -- exactly the case the two-axis rule
 *  says must be Zod-validated rather than annotated and hoped over. safeParse
 *  (not parse) with a documented fallback: an unset APP_ENV is the normal local
 *  case and must not fail a config read, while a MISSPELLED one must not
 *  silently become an OTA-enabled build. Anything unrecognised falls back to
 *  development, the most restrictive answer. */
export function resolveAppEnv(raw: unknown): AppEnv {
  const parsed = AppEnvSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'development';
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const appEnv: AppEnv = resolveAppEnv(process.env['APP_ENV']);
  const enabled: boolean = OTA_ENABLED_ENVS.includes(appEnv);
  return {
    ...(config as ExpoConfig),
    updates: {
      ...config.updates,
      enabled,
      // fallbackToCacheTimeout 0 is what makes enabling this safe at cold
      // start: the app NEVER blocks on the network waiting for a manifest, it
      // launches on the embedded bundle and swaps in any update next launch.
      fallbackToCacheTimeout: 0,
      // Explicit rather than implied. ON_LOAD is the default, but a disabled
      // binary should not even ask, and stating it makes the difference between
      // the two answers visible in one place.
      checkAutomatically: enabled ? 'ON_LOAD' : 'NEVER',
    },
  };
};
