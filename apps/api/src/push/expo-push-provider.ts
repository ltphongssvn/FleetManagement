// apps/api/src/push/expo-push-provider.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { deviceRegistry } from '../database/schema/device.js';
import type { IPushProvider, PushBody, PushSendResult } from './push-provider.interface.js';

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
      const msg: ExpoPushMessage = { to, title: body.title, body: body.body, sound: 'default' };
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
