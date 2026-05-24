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

const eas = JSON.parse(readFileSync(resolve(__dirname, '../eas.json'), 'utf8')) as EasJson;
const app = JSON.parse(readFileSync(resolve(__dirname, '../app.json'), 'utf8')) as AppJson;

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
