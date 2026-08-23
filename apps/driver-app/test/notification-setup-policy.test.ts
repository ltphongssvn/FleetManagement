// apps/driver-app/test/notification-setup-policy.test.ts
// S5a (T12 driver-order-alerts): pure policy orchestrating the native push
// bring-up sequence WITHOUT importing expo-notifications/expo-device -- all
// native effects go through an injected NotificationPlatformPort so the ordering
// + gating logic is unit-testable on the 9.7GiB box with no device/emulator.
// Ordering is load-bearing (Android 13+): the channel MUST be created BEFORE the
// permission request / token fetch, else the OS prompt never appears and
// getExpoPushTokenAsync returns nothing. The channel config imports the shared
// SSOT constants from @fleet/sync-protocol (one definition, api + app consume).
// Mock fns are captured as locals BEFORE assembling the port (never read off
// the port object) to satisfy @typescript-eslint/unbound-method.
import { describe, it, expect, vi } from 'vitest';
import {
  runNotificationSetup,
  buildTransportAlertChannelConfig,
  type NotificationPlatformPort,
  type NotificationSetupResult,
  type TransportAlertChannelConfig,
  type PermissionStatus,
} from '../src/push/notification-setup-policy.js';
import {
  DRIVER_ALERT_ANDROID_CHANNEL_ID,
  DRIVER_ALERT_SOUND,
  DRIVER_ALERT_VIBRATION_PATTERN,
} from '@fleet/sync-protocol';

const VALID_TOKEN = 'ExponentPushToken[abc123]';

interface PortHarness {
  port: NotificationPlatformPort;
  calls: string[];
  setChannel: ReturnType<typeof vi.fn>;
  getPermissionStatus: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
  getExpoPushToken: ReturnType<typeof vi.fn>;
}

function makeHarness(
  opts: {
    isPhysicalDevice?: boolean;
    permissionStatus?: PermissionStatus;
    requestResult?: PermissionStatus;
  } = {},
): PortHarness {
  const calls: string[] = [];
  const isPhysical = opts.isPhysicalDevice ?? true;
  const permStatus = opts.permissionStatus ?? 'granted';
  const reqResult = opts.requestResult ?? 'granted';
  const setChannel = vi.fn((id: string, config: TransportAlertChannelConfig): Promise<void> => {
    calls.push('setChannel:' + id);
    void config;
    return Promise.resolve();
  });
  const getPermissionStatus = vi.fn((): Promise<PermissionStatus> => {
    calls.push('getPerm');
    return Promise.resolve(permStatus);
  });
  const requestPermission = vi.fn((): Promise<PermissionStatus> => {
    calls.push('reqPerm');
    return Promise.resolve(reqResult);
  });
  const getExpoPushToken = vi.fn((): Promise<string> => {
    calls.push('getToken');
    return Promise.resolve(VALID_TOKEN);
  });
  const port: NotificationPlatformPort = {
    isPhysicalDevice: (): boolean => isPhysical,
    setChannel,
    getPermissionStatus,
    requestPermission,
    getExpoPushToken,
  };
  return { port, calls, setChannel, getPermissionStatus, requestPermission, getExpoPushToken };
}

describe('@fleet/driver-app - buildTransportAlertChannelConfig', () => {
  it('builds a MAX-importance alarm channel from the shared SSOT constants', () => {
    const cfg = buildTransportAlertChannelConfig();
    expect(cfg.channelId).toBe(DRIVER_ALERT_ANDROID_CHANNEL_ID);
    expect(cfg.sound).toBe(DRIVER_ALERT_SOUND);
    expect(cfg.vibrationPattern).toEqual(DRIVER_ALERT_VIBRATION_PATTERN);
    expect(cfg.enableVibrate).toBe(true);
    expect(cfg.importance).toBe('max');
    expect(cfg.audioUsage).toBe('alarm');
  });
});

describe('@fleet/driver-app - runNotificationSetup', () => {
  it('creates the channel BEFORE requesting permission and fetching the token (Android 13+ ordering)', async () => {
    const h = makeHarness();
    await runNotificationSetup(h.port);
    const channelIdx = h.calls.indexOf('setChannel:' + DRIVER_ALERT_ANDROID_CHANNEL_ID);
    const tokenIdx = h.calls.indexOf('getToken');
    expect(channelIdx).toBeGreaterThanOrEqual(0);
    expect(channelIdx).toBeLessThan(tokenIdx);
    const permCandidates = [h.calls.indexOf('getPerm'), h.calls.indexOf('reqPerm')].filter(
      (i) => i >= 0,
    );
    const permIdx = Math.min(...permCandidates);
    expect(channelIdx).toBeLessThan(permIdx);
  });
  it('returns the token when permission already granted (no re-request)', async () => {
    const h = makeHarness();
    const r: NotificationSetupResult = await runNotificationSetup(h.port);
    expect(r.outcome).toBe('ready');
    if (r.outcome === 'ready') expect(r.token).toBe(VALID_TOKEN);
    expect(h.requestPermission.mock.calls.length).toBe(0);
  });
  it('requests permission when undetermined, then fetches token on grant', async () => {
    const h = makeHarness({ permissionStatus: 'undetermined', requestResult: 'granted' });
    const r = await runNotificationSetup(h.port);
    expect(h.requestPermission.mock.calls.length).toBe(1);
    expect(r.outcome).toBe('ready');
  });
  it('returns permission_denied (no token fetch) when permission is refused', async () => {
    const h = makeHarness({ permissionStatus: 'undetermined', requestResult: 'denied' });
    const r = await runNotificationSetup(h.port);
    expect(r.outcome).toBe('permission_denied');
    expect(h.getExpoPushToken.mock.calls.length).toBe(0);
  });
  it('returns not_supported on a non-physical device (emulator: no push, but channel still set)', async () => {
    const h = makeHarness({ isPhysicalDevice: false });
    const r = await runNotificationSetup(h.port);
    expect(r.outcome).toBe('not_supported');
    expect(h.getExpoPushToken.mock.calls.length).toBe(0);
    expect(h.setChannel.mock.calls.length).toBe(1);
  });
});
