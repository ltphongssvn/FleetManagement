// apps/api/test/expo-push-provider.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { ExpoPushProvider, defaultExpoClient, type ExpoLike } from '../src/push/expo-push-provider.js';
import type { FleetDb } from '../src/database/database.module.js';

function dbWithTokens(tokens: (string | null)[]): DeepMockProxy<FleetDb> {
  const db = mockDeep<FleetDb>();
  db.select.mockImplementation(() => ({
    from: () => ({
      where: () => Promise.resolve(tokens.map((token) => ({ token }))),
    }),
  }) as never);
  return db;
}

function fakeExpo(opts: {
  isValid?: (t: unknown) => boolean;
  ticketStatuses?: string[];
  throws?: boolean;
}): ExpoLike {
  return {
    isExpoPushToken: opts.isValid ?? ((t) => typeof t === 'string' && t.startsWith('ExponentPushToken[')),
    chunkPushNotifications: (m) => [m],
    sendPushNotificationsAsync: vi.fn(() => {
      if (opts.throws) return Promise.reject(new Error('network'));
      return Promise.resolve((opts.ticketStatuses ?? []).map((status) => ({ status })));
    }),
  };
}

const VALID_TOKEN = 'ExponentPushToken[abc123]';

describe('@fleet/api - ExpoPushProvider', () => {
  it('returns rejected=1 when operator has no tokens', async () => {
    const p = new ExpoPushProvider(dbWithTokens([]), fakeExpo({}));
    expect(await p.sendToOperator('op1', { title: 't', body: 'b' })).toEqual({ accepted: 0, rejected: 1 });
  });

  it('returns rejected when operator has only invalid tokens', async () => {
    const p = new ExpoPushProvider(dbWithTokens(['not-a-token', null]), fakeExpo({}));
    const r = await p.sendToOperator('op1', { title: 't', body: 'b' });
    expect(r.accepted).toBe(0);
    expect(r.rejected).toBeGreaterThan(0);
  });

  it('counts ok tickets as accepted', async () => {
    const p = new ExpoPushProvider(dbWithTokens([VALID_TOKEN]), fakeExpo({ ticketStatuses: ['ok'] }));
    expect(await p.sendToOperator('op1', { title: 't', body: 'b' })).toEqual({ accepted: 1, rejected: 0 });
  });

  it('counts error tickets as rejected', async () => {
    const p = new ExpoPushProvider(dbWithTokens([VALID_TOKEN]), fakeExpo({ ticketStatuses: ['error'] }));
    expect(await p.sendToOperator('op1', { title: 't', body: 'b' })).toEqual({ accepted: 0, rejected: 1 });
  });

  it('counts entire chunk as rejected when send throws', async () => {
    const p = new ExpoPushProvider(dbWithTokens([VALID_TOKEN, VALID_TOKEN]), fakeExpo({ throws: true }));
    const r = await p.sendToOperator('op1', { title: 't', body: 'b' });
    expect(r.accepted).toBe(0);
    expect(r.rejected).toBe(2);
  });

  it('handles mixed valid/invalid tokens', async () => {
    const p = new ExpoPushProvider(dbWithTokens([VALID_TOKEN, 'bad', null]), fakeExpo({ ticketStatuses: ['ok'] }));
    const r = await p.sendToOperator('op1', { title: 't', body: 'b' });
    expect(r.accepted).toBe(1);
  });

  it('defaultExpoClient returns ExpoLike with all methods', () => {
    const client = defaultExpoClient();
    expect(typeof client.isExpoPushToken).toBe('function');
    expect(typeof client.chunkPushNotifications).toBe('function');
    expect(typeof client.sendPushNotificationsAsync).toBe('function');
  });

  it('defaultExpoClient.isExpoPushToken validates tokens', () => {
    const client = defaultExpoClient();
    expect(client.isExpoPushToken('ExponentPushToken[abc]')).toBe(true);
    expect(client.isExpoPushToken('not-a-token')).toBe(false);
  });

  it('defaultExpoClient wires Expo SDK (lines 22-29)', async () => {
    const { defaultExpoClient } = await import('../src/push/expo-push-provider.js');
    const client = defaultExpoClient();
    expect(typeof client.isExpoPushToken).toBe('function');
    expect(typeof client.chunkPushNotifications).toBe('function');
    expect(typeof client.sendPushNotificationsAsync).toBe('function');
    // isExpoPushToken returns false on garbage input (delegates to real SDK)
    expect(client.isExpoPushToken('not-a-real-token')).toBe(false);
  });
});
