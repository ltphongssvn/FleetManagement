// apps/driver-app/test/notification-setup-native-wiring.test.ts
// S5d (T12 driver-order-alerts) -- outside-in strict TDD, wiring guard.
//
// S5a shipped the PURE policy (runNotificationSetup + the
// NotificationPlatformPort seam). This slice pins the IMPERATIVE SHELL that
// fills that seam: notification-setup-native.ts, wrapping expo-notifications
// and expo-device. The adapter is unreachable from a dev-box unit test (it
// calls native modules), so it follows the established native-adapter pattern
// -- native-bootstrap.ts, fetch-sync-transport.ts -- and is coverage-EXCLUDED.
// The compensating control is this source-contract guard, which asserts the
// adapter says what it must say. That is exactly the trade the existing
// wiring guards make (capture-auto-advance-wiring.test.ts).
//
// Why each invariant is load-bearing:
//  - The barrel must export the policy surface: the adapter and _layout wire
//    against @fleet/driver-app internals through src/index.ts, as every other
//    policy does. An unexported policy is a policy nobody can call.
//  - The adapter must map onto AndroidImportance.MAX: anything less than MAX
//    means no heads-up banner and no sound -- a silent alert at 4AM.
//  - AndroidAudioUsage/ALARM routes the custom tone through the ALARM stream,
//    which plays THROUGH a silenced ringer. This is the single line that makes
//    a phone on silent still wake the driver, and the whole mission rests on it.
//  - The channel must be registered with the SHARED SSOT id and sound, never a
//    local literal: the api sender (cc59b78) stamps DRIVER_ALERT_* on every
//    message, and a channelId/sound mismatch means FCM delivers to a channel
//    that does not exist -> the OS silently drops to a default channel.
//  - shouldPlaySound/shouldShowBanner in the foreground handler: without a
//    handler, expo-notifications shows NOTHING while the app is foregrounded.
//  - The adapter must be coverage-excluded, or the 90/90/90/90 perFile gate
//    fails on code no unit test can legitimately reach.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRIVER_ALERT_ANDROID_CHANNEL_ID, DRIVER_ALERT_SOUND } from '@fleet/sync-protocol';
import * as barrel from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(resolve(here, '..', rel), 'utf8');

const ADAPTER = 'src/push/notification-setup-native.ts';

describe('@fleet/driver-app - notification setup barrel surface', () => {
  it('exports runNotificationSetup from the barrel', () => {
    expect(
      typeof (barrel as Record<string, unknown>)['runNotificationSetup'],
      'the adapter and _layout call the policy through the barrel',
    ).toBe('function');
  });

  it('exports buildTransportAlertChannelConfig from the barrel', () => {
    expect(
      typeof (barrel as Record<string, unknown>)['buildTransportAlertChannelConfig'],
      'the native adapter builds its channel input from the shared config builder',
    ).toBe('function');
  });

  it('the barrel-exported channel config carries the shared SSOT id and sound', () => {
    const build = (barrel as Record<string, unknown>)[
      'buildTransportAlertChannelConfig'
    ] as () => Record<string, unknown>;
    const cfg = build();
    expect(
      cfg['channelId'],
      'channel id must come from the shared contract, not a local literal',
    ).toBe(DRIVER_ALERT_ANDROID_CHANNEL_ID);
    expect(
      cfg['sound'],
      'sound must come from the shared contract so sender and channel agree',
    ).toBe(DRIVER_ALERT_SOUND);
  });
});

describe('@fleet/driver-app - notification-setup native adapter contract', () => {
  it('the native adapter module exists', () => {
    expect(
      () => src(ADAPTER),
      'notification-setup-native.ts fills the NotificationPlatformPort seam',
    ).not.toThrow();
  });

  it('imports expo-notifications and expo-device', () => {
    const s = src(ADAPTER);
    expect(s.includes('expo-notifications'), 'the adapter wraps expo-notifications').toBe(true);
    expect(s.includes('expo-device'), 'expo-device backs the isPhysicalDevice gate').toBe(true);
  });

  it('registers the channel at MAX importance (heads-up + sound)', () => {
    const s = src(ADAPTER);
    expect(
      s.includes('AndroidImportance.MAX'),
      'below MAX there is no heads-up banner and no sound',
    ).toBe(true);
  });

  it('routes the tone through the ALARM audio usage (plays through a silenced ringer)', () => {
    const s = src(ADAPTER);
    expect(
      s.includes('AndroidAudioUsage.ALARM'),
      'ALARM usage is what makes a phone on silent still wake the driver',
    ).toBe(true);
  });

  it('calls setNotificationChannelAsync to register the channel', () => {
    const s = src(ADAPTER);
    expect(
      s.includes('setNotificationChannelAsync'),
      'the channel must actually be created, not merely described',
    ).toBe(true);
  });

  it('builds its channel input from the shared config builder, never local literals', () => {
    const s = src(ADAPTER);
    expect(
      s.includes('buildTransportAlertChannelConfig') || s.includes('config.channelId'),
      'the adapter consumes the policy config; it does not restate the contract',
    ).toBe(true);
    expect(
      s.includes('transport-orders-v1'),
      'a hardcoded channel id would drift from the api sender SSOT',
    ).toBe(false);
    expect(
      s.includes('transport_alert.wav'),
      'a hardcoded sound filename would drift from the api sender SSOT',
    ).toBe(false);
  });

  it('installs a foreground handler that plays sound and shows a banner', () => {
    const s = src(ADAPTER);
    expect(
      s.includes('setNotificationHandler'),
      'without a handler expo-notifications shows nothing while foregrounded',
    ).toBe(true);
    expect(s.includes('shouldPlaySound'), 'the foreground alert must be audible too').toBe(true);
  });

  it('requests the Android permission through the port, not ad-hoc', () => {
    const s = src(ADAPTER);
    expect(
      s.includes('requestPermissionsAsync'),
      'Android 13+ requires an explicit runtime request',
    ).toBe(true);
    expect(
      s.includes('getPermissionsAsync'),
      'status must be read before prompting so a granted install never re-prompts',
    ).toBe(true);
  });

  it('gates the token fetch on a physical device', () => {
    const s = src(ADAPTER);
    expect(
      s.includes('isDevice'),
      'expo-device isDevice gates getExpoPushTokenAsync; emulators yield no token',
    ).toBe(true);
    expect(
      s.includes('getExpoPushTokenAsync'),
      'the adapter must fetch the Expo token the policy hands to decidePushRegistration',
    ).toBe(true);
  });

  it('registers the live tap listener via addNotificationResponseReceivedListener', () => {
    const s = src(ADAPTER);
    expect(
      s.includes('addNotificationResponseReceivedListener'),
      'the fg/bg tap path must use the expo response listener',
    ).toBe(true);
  });

  it('drains the cold-start tap via the SYNC getLastNotificationResponse (SDK 55)', () => {
    const s = src(ADAPTER);
    expect(
      s.includes('getLastNotificationResponse()'),
      'a killed-app launch-by-tap is missed by the listener; the initial response must be drained. SDK 55 exposes the SYNC getLastNotificationResponse; the deprecated *Async is banned by no-deprecated',
    ).toBe(true);
    expect(
      s.includes('getLastNotificationResponseAsync'),
      'the deprecated Async variant must not be used',
    ).toBe(false);
  });

  it('routes BOTH tap paths through the pure decideDriverAlertNavigation policy', () => {
    const s = src(ADAPTER);
    expect(
      s.includes('decideDriverAlertNavigation('),
      'the untrusted payload must go through the pure fail-safe policy, never parsed inline in the adapter',
    ).toBe(true);
    const handleCount = (s.match(/handleNotificationResponse/g) ?? []).length;
    expect(
      handleCount,
      'both the listener and the drain must funnel through the single handleNotificationResponse mapper (defn + 2 call sites)',
    ).toBeGreaterThanOrEqual(3);
  });

  it('types the tap subscription as the non-deprecated EventSubscription', () => {
    const s = src(ADAPTER);
    expect(
      s.includes('EventSubscription'),
      'SDK 55 deprecates the Subscription type; the subscription must be typed EventSubscription (no-deprecated)',
    ).toBe(true);
    expect(
      s.includes('Notifications.Subscription'),
      'the deprecated Subscription type must not be used',
    ).toBe(false);
  });

  it('is coverage-excluded like the other native adapters', () => {
    const cfg = src('vitest.config.ts');
    expect(
      cfg.includes(ADAPTER),
      'native modules cannot be unit tested; the perFile 90 gate would fail on unreachable code',
    ).toBe(true);
  });
});
