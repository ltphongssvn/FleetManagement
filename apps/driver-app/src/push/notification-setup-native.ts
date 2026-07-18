// apps/driver-app/src/push/notification-setup-native.ts
// S5d (T12 driver-order-alerts): the IMPERATIVE SHELL behind
// NotificationPlatformPort. Every decision lives in notification-setup-policy
// (pure, unit-tested); this file only translates those decisions into
// expo-notifications / expo-device calls. Coverage-EXCLUDED like the other
// native adapters (native-bootstrap.ts, fetch-sync-transport.ts): it cannot
// run on the dev box. Its compensating control is the source-contract guard
// test/notification-setup-native-wiring.test.ts.
//
// Delivery mechanics, and why each is the difference between a truck rolling
// at 4AM and a missed run:
//  - AndroidImportance.MAX: below MAX there is no heads-up banner and no
//    sound. IMPORTANCE_DEFAULT would make the alert a silent status-bar icon.
//  - AndroidAudioUsage.ALARM: routes the tone through the ALARM stream, which
//    plays THROUGH a silenced ringer. This single field is what lets a phone
//    on silent still wake the driver.
//  - bypassDnd: Do Not Disturb is on by default overnight on many HyperOS /
//    OneUI builds -- exactly the hours that matter here.
//  - lockscreenVisibility PUBLIC: the order ref must be readable without
//    unlocking, so the driver knows it is a job and not spam.
//  - The channel is registered BEFORE any permission prompt (the policy owns
//    that ordering) and is IMMUTABLE once created on-device: importance,
//    sound and vibration freeze at first creation. Changing any of them needs
//    a new channel id -- hence the -v1 in the shared constant.
//
// Contract discipline: nothing here restates the wire contract. The channel id
// and sound arrive via TransportAlertChannelConfig, built from the
// @fleet/sync-protocol SSOT that the api sender also stamps on every message.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import {
  buildTransportAlertChannelConfig,
  runNotificationSetup,
  type NotificationPlatformPort,
  type NotificationSetupResult,
  type PermissionStatus,
  type TransportAlertChannelConfig,
} from '../index.js';

// Vietnamese: the channel name is user-visible in Android notification
// settings, where the driver may need to find it to re-enable sound.
const CHANNEL_NAME_VI = 'Lệnh điều xe';
const CHANNEL_DESCRIPTION_VI = 'Báo động khi có lệnh điều xe mới. Không tắt âm.';

/** Foreground presentation. Without a handler, expo-notifications shows
 *  NOTHING while the app is open -- a driver staring at the app would be the
 *  only person who misses the alert.
 *
 *  handleNotification is typed as returning a Promise, but the decision here
 *  is a constant: there is nothing to await. Returning Promise.resolve keeps
 *  the required type honestly instead of marking the function async and
 *  suppressing require-await -- the behaviour is synchronous, so the source
 *  should say so. */
export function installForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
  });
}

/** expo-notifications reports a richer status than the policy branches on;
 *  collapse it onto the three states. canAskAgain distinguishes a first run
 *  (prompt) from a hard denial (do not nag). */
function toPermissionStatus(res: Notifications.NotificationPermissionsStatus): PermissionStatus {
  if (res.granted) return 'granted';
  if (res.canAskAgain) return 'undetermined';
  return 'denied';
}

/** getExpoPushTokenAsync needs the EAS project id explicitly in SDK 55; it is
 *  read from the same app.json the config plugin uses. */
function easProjectId(): string {
  const extra = Constants.expoConfig?.extra;
  const eas = extra?.['eas'] as { projectId?: unknown } | undefined;
  const projectId = eas?.projectId;
  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error('expo.extra.eas.projectId is missing -- no Expo push token can be minted');
  }
  return projectId;
}

export function createNotificationPlatformPort(): NotificationPlatformPort {
  return {
    isPhysicalDevice(): boolean {
      // Emulators mint no push token; the policy turns this into not_supported.
      return Device.isDevice;
    },

    async setChannel(channelId: string, config: TransportAlertChannelConfig): Promise<void> {
      // Channels are an Android concept; iOS delivery mechanics ride on the
      // per-message interruptionLevel the api sender already stamps.
      if (Platform.OS !== 'android') return;
      await Notifications.setNotificationChannelAsync(channelId, {
        name: CHANNEL_NAME_VI,
        description: CHANNEL_DESCRIPTION_VI,
        importance: Notifications.AndroidImportance.MAX,
        sound: config.sound,
        vibrationPattern: [...config.vibrationPattern],
        enableVibrate: config.enableVibrate,
        enableLights: true,
        bypassDnd: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        showBadge: true,
        audioAttributes: {
          usage: Notifications.AndroidAudioUsage.ALARM,
          contentType: Notifications.AndroidAudioContentType.SONIFICATION,
        },
      });
    },

    async getPermissionStatus(): Promise<PermissionStatus> {
      // Read before prompting: an already-granted install must never re-prompt.
      return toPermissionStatus(await Notifications.getPermissionsAsync());
    },

    async requestPermission(): Promise<PermissionStatus> {
      // Android 13+ POST_NOTIFICATIONS is a runtime grant; iOS needs the
      // alert/sound authorization. allowCriticalAlerts is deliberately absent
      // -- it requires an Apple entitlement we do not hold; the api sender
      // uses interruptionLevel time-sensitive instead.
      return toPermissionStatus(
        await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        }),
      );
    },

    async getExpoPushToken(): Promise<string> {
      const token = await Notifications.getExpoPushTokenAsync({ projectId: easProjectId() });
      return token.data;
    },
  };
}

/** Channel-only fast path for app boot: the channel should exist from the very
 *  first launch, before login, so the asset-before-channel ordering can never
 *  be lost to an auth failure. Safe to call repeatedly. */
export async function registerTransportAlertChannel(): Promise<void> {
  const config = buildTransportAlertChannelConfig();
  await createNotificationPlatformPort().setChannel(config.channelId, config);
}

/** Full bring-up: foreground handler + channel-first policy run. The returned
 *  token is what the caller feeds to decidePushRegistration. */
export async function setUpDriverAlerts(): Promise<NotificationSetupResult> {
  installForegroundHandler();
  return runNotificationSetup(createNotificationPlatformPort());
}
