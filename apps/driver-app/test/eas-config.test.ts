// apps/driver-app/test/eas-config.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
interface EasJson {
  build: {
    development: { developmentClient: boolean; env: Record<string, string> };
    preview: { channel: string; android: { buildType: string }; env: Record<string, string> };
    production: { channel: string; autoIncrement: boolean; env: Record<string, string> };
  };
  update?: unknown;
}
interface AppJson {
  expo: {
    updates: { url: string };
    runtimeVersion: { policy: string };
    extra: { eas: { projectId: string } };
  };
}
interface PkgJson {
  devDependencies?: Record<string, string>;
}
const eas = JSON.parse(readFileSync(resolve(__dirname, '../eas.json'), 'utf8')) as EasJson;
const app = JSON.parse(readFileSync(resolve(__dirname, '../app.json'), 'utf8')) as AppJson;
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as PkgJson;
const PROFILES = ['development', 'preview', 'production'] as const;
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
