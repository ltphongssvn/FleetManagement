// apps/driver-app/test/notification-native-bundle-config.test.ts
// S5b (T12 driver-order-alerts) -- outside-in strict TDD, L1 config guard.
// The 4AM wake-up depends on NATIVE config that no unit test of a pure policy
// can reach. This file pins the committed-source contract (ADR-005: android/
// and ios/ are gitignored CNG artifacts, so every native setting is asserted
// against app.json + committed assets, never against a prebuild output).
//
// Why each invariant is load-bearing:
//  - expo-notifications/expo-device must be real dependencies: the channel
//    adapter (S5d) imports them, and a missing dep fails only at EAS build.
//  - The custom sound must be BUNDLED and declared via the expo-notifications
//    config plugin sounds[] array: the plugin copies it into android res/raw
//    and the iOS bundle at prebuild. A channel registered against a missing
//    raw resource silently falls back to the DEFAULT tone -- and an Android
//    channel is IMMUTABLE once created on-device, so that mistake is permanent
//    per install (only a new channel id or a reinstall clears it).
//    Asset-before-channel is therefore an ordering CONTRACT, not a preference.
//  - The bundled filename must equal DRIVER_ALERT_SOUND from the shared SSOT:
//    the api sender stamps that exact string on every ExpoPushMessage. Drift
//    between sender and bundle = a silent notification.
//  - iOS UIBackgroundModes remote-notification lets APNs wake the app.
//  - Android 13+ POST_NOTIFICATIONS: undeclared => no runtime prompt => every
//    alert is dropped silently. VIBRATE backs the independent buzz channel.
//
// Assertion style (eslint vitest/valid-expect): a second expect() argument is
// accepted ONLY as a plain string literal, never a concatenation -- so per-item
// context is carried by asserting on a FILTERED ARRAY (offending paths surface
// in the diff) rather than interpolated into the message. Every list-driven
// guard asserts the list is non-empty FIRST: a bare loop over an empty sounds[]
// passes vacuously and guards nothing.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DRIVER_ALERT_SOUND } from '@fleet/sync-protocol';

type PluginEntry = [string, Record<string, unknown>];
interface ExpoConfig {
  expo: {
    plugins: (string | PluginEntry)[];
    ios?: { infoPlist?: Record<string, unknown> };
    android?: { permissions?: string[] };
  };
}
interface PkgJson {
  dependencies?: Record<string, string>;
}

const appJsonPath = resolve(__dirname, '../app.json');
const pkgJsonPath = resolve(__dirname, '../package.json');
const app = JSON.parse(readFileSync(appJsonPath, 'utf8')) as ExpoConfig;
const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as PkgJson;

function findPlugin(name: string): PluginEntry | undefined {
  for (const p of app.expo.plugins) {
    if (Array.isArray(p) && p[0] === name) return p;
  }
  return undefined;
}

function declaredSounds(): string[] {
  return (findPlugin('expo-notifications')?.[1]?.['sounds'] ?? []) as string[];
}

function androidPermissions(): string[] {
  return app.expo.android?.permissions ?? [];
}

describe('@fleet/driver-app - transport alert native bundle contract', () => {
  it('declares expo-notifications as a dependency', () => {
    const deps = pkg.dependencies ?? {};
    expect(
      deps['expo-notifications'],
      'expo-notifications must be a real dependency, not a transitive hope',
    ).toBeDefined();
  });

  it('declares expo-device as a dependency (physical-device gate)', () => {
    const deps = pkg.dependencies ?? {};
    expect(
      deps['expo-device'],
      'expo-device backs NotificationPlatformPort.isPhysicalDevice',
    ).toBeDefined();
  });

  it('declares the expo-notifications config plugin', () => {
    expect(
      findPlugin('expo-notifications'),
      'expo-notifications must be a configured plugin so prebuild wires the native side',
    ).toBeDefined();
  });

  it('bundles at least one custom alert sound through the plugin sounds[] array', () => {
    const sounds = findPlugin('expo-notifications')?.[1]?.['sounds'];
    expect(
      Array.isArray(sounds),
      'plugin sounds[] must be an array listing the bundled asset',
    ).toBe(true);
    expect((sounds as string[]).length, 'at least one sound must be bundled').toBeGreaterThan(0);
  });

  it('the bundled sound basename equals the shared DRIVER_ALERT_SOUND SSOT', () => {
    const basenames = declaredSounds().map((s) => s.split('/').pop());
    expect(
      basenames,
      'the api sender stamps DRIVER_ALERT_SOUND on every message; the bundle must match exactly',
    ).toContain(DRIVER_ALERT_SOUND);
  });

  it('every declared sound asset exists on disk', () => {
    const sounds = declaredSounds();
    expect(sounds.length, 'sounds[] must be non-empty or this guard is vacuous').toBeGreaterThan(0);
    const missing = sounds.filter((rel) => !existsSync(resolve(__dirname, '..', rel)));
    expect(
      missing,
      'declared in app.json but missing on disk -- prebuild would register a channel with the DEFAULT tone, permanently',
    ).toEqual([]);
  });

  it('every declared sound is a real non-empty RIFF/WAVE file (not a placeholder)', () => {
    const sounds = declaredSounds();
    expect(sounds.length, 'sounds[] must be non-empty or this guard is vacuous').toBeGreaterThan(0);
    const bad = sounds.filter((rel) => {
      const buf = readFileSync(resolve(__dirname, '..', rel));
      if (buf.length <= 1024) return true;
      if (buf.subarray(0, 4).toString('ascii') !== 'RIFF') return true;
      return buf.subarray(8, 12).toString('ascii') !== 'WAVE';
    });
    expect(bad, 'every declared sound must be a non-empty RIFF/WAVE audio file').toEqual([]);
  });

  it('enables the iOS remote-notification background mode (APNs may wake the app)', () => {
    const modes = (app.expo.ios?.infoPlist?.['UIBackgroundModes'] ?? []) as string[];
    expect(modes, 'UIBackgroundModes must include remote-notification').toContain(
      'remote-notification',
    );
  });

  it('declares android POST_NOTIFICATIONS (Android 13+ runtime prompt)', () => {
    expect(
      androidPermissions(),
      'without POST_NOTIFICATIONS the OS never prompts and every alert is dropped silently',
    ).toContain('android.permission.POST_NOTIFICATIONS');
  });

  it('declares android VIBRATE (independent delivery channel from sound)', () => {
    expect(
      androidPermissions(),
      'VIBRATE backs DRIVER_ALERT_VIBRATION_PATTERN on the transport channel',
    ).toContain('android.permission.VIBRATE');
  });
});
