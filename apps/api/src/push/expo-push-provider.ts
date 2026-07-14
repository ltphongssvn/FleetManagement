// apps/api/src/push/expo-push-provider.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { deviceRegistry } from '../database/schema/device.js';
import type { IPushProvider, PushBody, PushSendResult } from './push-provider.interface.js';

/** Android notification channel id for transport-order alerts. Immutable contract:
 *  the driver-app registers a channel with THIS exact id + high importance + a
 *  custom sound on the ALARM audio stream. Versioned because channel config is
 *  immutable once created on-device (a config change needs a new id). */
export const DRIVER_ALERT_ANDROID_CHANNEL_ID = 'transport-orders-v1' as const;
/** Bundled custom alert sound filename. Must match the asset the driver-app
 *  ships and the channel registers (Android plays the channel sound; iOS plays
 *  this file). Immutable contract value. */
export const DRIVER_ALERT_SOUND = 'transport_alert.wav' as const;
/** Android channel vibration pattern for transport-order alerts: [wait, buzz,
 *  wait, buzz, ...] in ms. An assertive triple-600ms buzz (vs a typical light
 *  [0,250,250,250] notification) so a 4AM driver feels it even pocketed/on a
 *  seat with sound suppressed -- vibration is an INDEPENDENT delivery channel
 *  from sound. Immutable contract; the driver-app registers this exact pattern
 *  with enableVibrate on the transport-orders channel. */
export const DRIVER_ALERT_VIBRATION_PATTERN: readonly number[] = [0, 600, 300, 600, 300, 600] as const;
/** Subset of Expo client API used by the adapter. Allows injection of a fake in tests. */
export interface ExpoLike {
  isExpoPushToken(token: unknown): boolean;
  chunkPushNotifications(messages: ExpoPushMessage[]): ExpoPushMessage[][];
  sendPushNotificationsAsync(messages: ExpoPushMessage[]): Promise<{ status: string }[]>;
}

export const EXPO_CLIENT = 'EXPO_CLIENT' as const;

/** Default factory: real Expo client. Tests bind a fake via DI. */
export function defaultExpoClient(): ExpoLike {
  const expo = new Expo();
  return {
    isExpoPushToken: (token) => Expo.isExpoPushToken(token),
    chunkPushNotifications: (m) => expo.chunkPushNotifications(m),
    sendPushNotificationsAsync: async (m) => {
      const tickets = await expo.sendPushNotificationsAsync(m);
      return tickets.map((t) => ({ status: t.status }));
    },
  };
}

@Injectable()
export class ExpoPushProvider implements IPushProvider {
  private readonly logger = new Logger(ExpoPushProvider.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: FleetDb,
    @Inject(EXPO_CLIENT) private readonly expo: ExpoLike,
  ) {}

  async sendToOperator(operatorId: string, body: PushBody): Promise<PushSendResult> {
    const rows = await this.db
      .select({ token: deviceRegistry.expoPushToken })
      .from(deviceRegistry)
      .where(eq(deviceRegistry.operatorId, operatorId));

    const tokens = rows.map((r) => r.token).filter((t): t is string => t !== null && this.expo.isExpoPushToken(t));
    if (tokens.length === 0) {
      this.logger.warn(`No valid Expo push tokens for operator ${operatorId}`);
      return { accepted: 0, rejected: 1 };
    }

    const messages: ExpoPushMessage[] = tokens.map((to) => {
      const msg: ExpoPushMessage = {
        to,
        title: body.title,
        body: body.body,
        // 4AM wake-reliability (T12, 2026 research-locked): every order alert is
        // a critical delivery. priority high wakes a Dozing Android immediately;
        // channelId routes to the driver-app high-importance channel whose custom
        // sound plays on the ALARM stream (audible on a silenced phone);
        // interruptionLevel time-sensitive breaks through iOS notification
        // controls without the critical-alerts entitlement. sound matches the
        // bundled asset the driver-app channel registers.
        sound: DRIVER_ALERT_SOUND,
        priority: 'high',
        channelId: DRIVER_ALERT_ANDROID_CHANNEL_ID,
        interruptionLevel: 'time-sensitive',
      } as ExpoPushMessage;
      if (body.data !== undefined) (msg as { data: Record<string, unknown> }).data = body.data;
      return msg;
    });

    const chunks = this.expo.chunkPushNotifications(messages);
    let accepted = 0;
    let rejected = 0;
    for (const chunk of chunks) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        for (const t of tickets) {
          if (t.status === 'ok') accepted += 1;
          else rejected += 1;
        }
      } catch (err) {
        this.logger.error('Expo push chunk failed', err);
        rejected += chunk.length;
      }
    }
    return { accepted, rejected };
  }
}
