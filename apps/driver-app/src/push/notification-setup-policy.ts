// apps/driver-app/src/push/notification-setup-policy.ts
// S5a (T12 driver-order-alerts): pure policy that orchestrates the native push
// bring-up. It performs NO native calls itself -- every effect goes through the
// injected NotificationPlatformPort, whose real adapter (notification-setup-
// native.ts) wraps expo-notifications/expo-device and is coverage-excluded like
// the other native adapters. This keeps the ordering + gating logic fully unit-
// testable on the dev box with no device.
//
// Ordering rule (Android 13+ / POST_NOTIFICATIONS): the notification channel
// MUST exist BEFORE the permission request and token fetch, or the OS never
// shows the prompt and getExpoPushTokenAsync yields nothing. runNotificationSetup
// therefore always sets the channel first, unconditionally (even on emulators,
// where push is unavailable but the channel is harmless), then gates on device +
// permission before fetching the token.
import {
  DRIVER_ALERT_ANDROID_CHANNEL_ID,
  DRIVER_ALERT_SOUND,
  DRIVER_ALERT_VIBRATION_PATTERN,
} from '@fleet/sync-protocol';

/** Android permission/channel status, normalized to the three states the
 *  policy branches on (expo-notifications reports more, but the adapter maps
 *  them onto these). */
export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

/** Android importance level for the channel. MAX = heads-up + sound, required
 *  for a wake-the-driver alert. */
export type ChannelImportance = 'max';
/** AudioAttributes usage. alarm routes the custom sound through the ALARM
 *  stream so it plays even when the ringer is silenced. */
export type ChannelAudioUsage = 'alarm';

/** The channel config the native adapter feeds to setNotificationChannelAsync.
 *  Built from the shared SSOT constants; the adapter maps these fields onto the
 *  expo-notifications NotificationChannelInput shape. */
export interface TransportAlertChannelConfig {
  readonly channelId: string;
  readonly importance: ChannelImportance;
  readonly sound: string;
  readonly vibrationPattern: readonly number[];
  readonly enableVibrate: boolean;
  readonly audioUsage: ChannelAudioUsage;
}

/** Native effects the policy needs, behind a port. The real adapter wraps
 *  expo-device + expo-notifications; tests inject a fake. */
export interface NotificationPlatformPort {
  isPhysicalDevice(): boolean;
  setChannel(channelId: string, config: TransportAlertChannelConfig): Promise<void>;
  getPermissionStatus(): Promise<PermissionStatus>;
  requestPermission(): Promise<PermissionStatus>;
  getExpoPushToken(): Promise<string>;
}

/** Outcome of the bring-up. ready carries the Expo token to hand to
 *  decidePushRegistration; the others explain why no token was produced. */
export type NotificationSetupResult =
  | { readonly outcome: 'ready'; readonly token: string }
  | { readonly outcome: 'permission_denied' }
  | { readonly outcome: 'not_supported' };

/** Build the transport-order alert channel config from the shared SSOT. */
export function buildTransportAlertChannelConfig(): TransportAlertChannelConfig {
  return {
    channelId: DRIVER_ALERT_ANDROID_CHANNEL_ID,
    importance: 'max',
    sound: DRIVER_ALERT_SOUND,
    vibrationPattern: DRIVER_ALERT_VIBRATION_PATTERN,
    enableVibrate: true,
    audioUsage: 'alarm',
  };
}

/** Orchestrate channel-first bring-up. Channel is always created first
 *  (ordering rule); token is fetched only on a physical device with granted
 *  permission. */
export async function runNotificationSetup(
  port: NotificationPlatformPort,
): Promise<NotificationSetupResult> {
  const config = buildTransportAlertChannelConfig();
  // ALWAYS first -- the OS prompt + token fetch depend on the channel existing.
  await port.setChannel(config.channelId, config);
  if (!port.isPhysicalDevice()) {
    return { outcome: 'not_supported' };
  }
  let status = await port.getPermissionStatus();
  if (status === 'undetermined') {
    status = await port.requestPermission();
  }
  if (status !== 'granted') {
    return { outcome: 'permission_denied' };
  }
  const token = await port.getExpoPushToken();
  return { outcome: 'ready', token };
}
