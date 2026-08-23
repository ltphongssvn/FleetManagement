// apps/driver-app/test/eas-config.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { resolve } from 'node:path';
import { APP_ENVS, AppEnvSchema, OTA_ENABLED_ENVS, resolveAppEnv } from '../app.config';
// eas.json and app.json are FILE INPUT read at test time -- a trust boundary,
// so they are Zod-parsed rather than cast through a hand-written interface.
// The previous `interface EasJson` was the Axis-2 shape: hand-maintained,
// unable to express "every profile has a channel", and it typechecked only
// until a profile was indexed dynamically.
const BuildProfileSchema = z
  .object({
    channel: z.string(),
    env: z.record(z.string(), z.string()),
    developmentClient: z.boolean().optional(),
    autoIncrement: z.boolean().optional(),
    android: z.object({ buildType: z.string() }).optional(),
  })
  .loose();

// build is NOT z.record: every profile below is REQUIRED, and a record would
// type each one optional -- a weaker claim than the file supports, which then
// forces `?.` noise at every call site. Naming them makes a deleted profile a
// PARSE failure with a precise message instead of a runtime undefined.
const EasJsonSchema = z.object({
  build: z.object({
    development: BuildProfileSchema,
    // preview REQUIRES android.buildType: it is the APK the 22 drivers
    // sideload, and "which artifact does preview emit" is the fact the OTA
    // decision rests on. Stating it here makes a dropped buildType a parse
    // failure rather than an undefined at the assertion.
    preview: BuildProfileSchema.extend({
      android: z.object({ buildType: z.string() }),
    }),
    production: BuildProfileSchema,
  }),
  update: z.unknown().optional(),
});
type EasJson = z.infer<typeof EasJsonSchema>;
type EasProfile = keyof EasJson['build'];

const AppJsonSchema = z.object({
  expo: z.object({
    updates: z.object({
      url: z.string(),
      fallbackToCacheTimeout: z.number(),
      enabled: z.boolean().optional(),
    }),
    runtimeVersion: z.object({ policy: z.string() }),
    extra: z.object({ eas: z.object({ projectId: z.string() }) }),
  }),
});

const PkgJsonSchema = z.object({
  devDependencies: z.record(z.string(), z.string()).optional(),
});

const eas = EasJsonSchema.parse(
  JSON.parse(readFileSync(resolve(__dirname, '../eas.json'), 'utf8')),
);
const app = AppJsonSchema.parse(
  JSON.parse(readFileSync(resolve(__dirname, '../app.json'), 'utf8')),
);
const pkg = PkgJsonSchema.parse(
  JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')),
);
// Derived from the schema, not restated: adding a profile above makes this
// list grow automatically and every loop below covers it.
const PROFILES = Object.keys(EasJsonSchema.shape.build.shape) as readonly EasProfile[];
describe('@fleet/driver-app - EAS config', () => {
  it('separates preview and production update channels', () => {
    expect(eas.build.preview.channel).toBe('preview');
    expect(eas.build.production.channel).toBe('production');
  });
  it('production build auto-increments version', () => {
    expect(eas.build.production.autoIncrement).toBe(true);
  });
  it('development build uses dev client', () => {
    expect(eas.build.development.developmentClient).toBe(true);
  });
  it('preview build emits APK for Android internal distribution', () => {
    expect(eas.build.preview.android.buildType).toBe('apk');
  });
  it('app.json updates.url contains EAS project id', () => {
    const projectId = app.expo.extra.eas.projectId;
    expect(app.expo.updates.url).toContain(projectId);
  });
  it('does not contain redundant top-level update key (channels live in build profiles)', () => {
    expect(eas.update).toBeUndefined();
  });
  it('separates env vars per profile', () => {
    expect(eas.build.development.env['APP_ENV']).toBe('development');
    expect(eas.build.preview.env['APP_ENV']).toBe('preview');
    expect(eas.build.production.env['APP_ENV']).toBe('production');
  });
  it('production EXPO_PUBLIC_API_URL is HTTPS', () => {
    expect(eas.build.production.env['EXPO_PUBLIC_API_URL']).toMatch(/^https:\/\//);
  });
  it('runtimeVersion policy is configured', () => {
    expect(app.expo.runtimeVersion.policy).toBeDefined();
  });
});

// ---- OTA delivery (2026-08-22) ----
// 22 drivers run sideloaded PREVIEW APKs. Rebuilding and asking all 22 to
// re-install is not an option, so EAS Update is the delivery mechanism -- and
// everything for it was wired except app.json's `updates.enabled: false`, which
// switched the whole thing off. app.config.ts now decides per APP_ENV.
describe('@fleet/driver-app - OTA delivery', () => {
  it('app.json no longer decides enablement -- app.config.ts is the SSOT', () => {
    // Two sources answering the same question is the drift shape this repo
    // keeps closing. The static flag is GONE; only the dynamic config decides.
    expect(app.expo.updates).not.toHaveProperty('enabled');
  });

  it('preview -- what the drivers actually run -- receives updates', () => {
    expect(OTA_ENABLED_ENVS).toContain('preview');
  });

  it('production receives updates', () => {
    expect(OTA_ENABLED_ENVS).toContain('production');
  });

  // The Maestro harness launches the app repeatedly across four flows against
  // an ALREADY-INSTALLED apk. An update applied between flows would change
  // behaviour mid-suite and read as an app bug.
  it('development and e2e binaries are excluded, so test runs stay byte-stable', () => {
    expect(OTA_ENABLED_ENVS).not.toContain('development');
    expect(OTA_ENABLED_ENVS).not.toContain('e2e');
  });

  // fallbackToCacheTimeout 0 is what makes enabling safe at cold start: the app
  // never blocks on the network for a manifest. Without it, a driver on a bad
  // connection waits at a blank screen.
  it('never blocks cold start on the update check', () => {
    expect(app.expo.updates.fallbackToCacheTimeout).toBe(0);
  });

  // Expo's own 2026 docs still call the fingerprint POLICY experimental and
  // recommend appVersion, with fingerprinting used as CI DETECTION -- which
  // this repo already has in //#eas:freshness. Changing the policy would also
  // change the runtime version of every install and orphan the drivers'
  // existing binaries.
  it('keeps the appVersion runtime policy, not the experimental fingerprint one', () => {
    expect(app.expo.runtimeVersion.policy).toBe('appVersion');
  });

  it('every OTA-enabled env has a matching eas.json channel', () => {
    for (const env of OTA_ENABLED_ENVS) {
      expect(eas.build[env as EasProfile].channel).toBe(env);
    }
  });

  // SSOT: eas.json's APP_ENV values must come from the same vocabulary the
  // config derives from. A profile added to eas.json with a typo'd APP_ENV
  // would otherwise resolve to development and silently lose OTA.
  it('every eas.json APP_ENV is a member of the schema vocabulary', () => {
    for (const profile of PROFILES) {
      expect(AppEnvSchema.safeParse(eas.build[profile].env['APP_ENV']).success).toBe(true);
    }
  });

  // Trust boundary: process.env is untrusted input, so the parse must be
  // total. Unset is the normal local case; misspelled must NOT become an
  // OTA-enabled build.
  it('resolves every known profile exactly', () => {
    for (const env of APP_ENVS) expect(resolveAppEnv(env)).toBe(env);
  });

  it('falls back to development for unset, misspelled or non-string input', () => {
    for (const bad of [undefined, '', 'Preview', 'prod', 42, null, {}]) {
      expect(resolveAppEnv(bad)).toBe('development');
    }
  });

  it('the fallback is NOT an OTA-enabled env, so a typo cannot enable updates', () => {
    expect(OTA_ENABLED_ENVS).not.toContain(resolveAppEnv('typo'));
  });
});
// Sentry iOS build-phase safety in a pnpm monorepo (sentry-react-native#4939):
// the Xcode 'Upload Debug Symbols to Sentry' run-script phase resolves
// @sentry/cli/package.json via Node require.resolve UNCONDITIONALLY, before it
// honors SENTRY_DISABLE_AUTO_UPLOAD. Under pnpm isolated node_modules a
// transitive-only @sentry/cli is unresolvable from the app dir, so the iOS
// archive dies with PhaseScriptExecution exit 65. The settled fix is
// three-layered: (1) declare @sentry/cli as a direct devDependency pinned to
// the exact version @sentry/react-native already resolves (zero drift, makes
// the resolve succeed), (2) disable auto upload in EVERY profile (no
// SENTRY_AUTH_TOKEN is provisioned), (3) SENTRY_ALLOW_FAILURE so upload
// tooling can never fail a build.
describe('@fleet/driver-app - Sentry iOS build-phase safety (pnpm monorepo)', () => {
  it('every build profile disables Sentry auto upload', () => {
    for (const profile of PROFILES) {
      expect({
        profile,
        SENTRY_DISABLE_AUTO_UPLOAD: eas.build[profile].env['SENTRY_DISABLE_AUTO_UPLOAD'],
      }).toEqual({ profile, SENTRY_DISABLE_AUTO_UPLOAD: 'true' });
    }
  });
  it('every build profile allows Sentry script-phase failure', () => {
    for (const profile of PROFILES) {
      expect({
        profile,
        SENTRY_ALLOW_FAILURE: eas.build[profile].env['SENTRY_ALLOW_FAILURE'],
      }).toEqual({ profile, SENTRY_ALLOW_FAILURE: 'true' });
    }
  });
  it('declares @sentry/cli as a direct devDependency pinned to the transitively-resolved version', () => {
    expect(pkg.devDependencies?.['@sentry/cli']).toBe('2.58.4');
  });
});
