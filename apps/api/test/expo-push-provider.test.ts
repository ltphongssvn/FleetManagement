// apps/api/test/expo-push-provider.test.ts
// PGlite integration: real device_registry table, real SELECT. Removes
// mockDeep<FleetDb> chain mock.
//
// Isolation: tx-injection per test (see helpers/with-tx-isolation.ts).
// ExpoPushProvider performs only a single SELECT (no this.db.transaction),
// so wrapping each test in an outer drizzle tx + constructing the provider
// with tx works without any inner-savepoint concerns.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  ExpoPushProvider,
  defaultExpoClient,
  DRIVER_ALERT_ANDROID_CHANNEL_ID,
  DRIVER_ALERT_SOUND,
  DRIVER_ALERT_VIBRATION_PATTERN,
  type ExpoLike,
} from '../src/push/expo-push-provider.js';
import { Expo } from 'expo-server-sdk';
import {
  startPgliteTestDb,
  stopPgliteTestDb,
  type PgliteTestDb,
} from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
let testDb: PgliteTestDb;
const qt = String.fromCharCode(39);
const TENANCY_VALS =
  qt +
  '00000000-0000-0000-0000-000000000001' +
  qt +
  '::uuid, ' +
  qt +
  '00000000-0000-0000-0000-000000000002' +
  qt +
  '::uuid, ' +
  qt +
  '00000000-0000-0000-0000-000000000003' +
  qt +
  '::uuid, ' +
  qt +
  '00000000-0000-0000-0000-000000000004' +
  qt +
  '::uuid';
const OPERATOR_ID = '00000000-0000-0000-0000-0000000000aa';
async function seedTokens(tx: TestTx, tokens: (string | null)[]): Promise<void> {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const tokenLit = token === null || token === undefined ? 'NULL' : qt + token + qt;
    const stmt =
      'INSERT INTO device_registry (company_id, business_unit_id, depot_id, legal_entity_id, operator_id, platform, app_version, expo_push_token) VALUES (' +
      TENANCY_VALS +
      ', ' +
      qt +
      OPERATOR_ID +
      qt +
      '::uuid, ' +
      qt +
      'platform-' +
      String(i) +
      qt +
      ', ' +
      qt +
      '1.0.0' +
      qt +
      ', ' +
      tokenLit +
      ')';
    await tx.execute(sql.raw(stmt));
  }
}
function fakeExpo(opts: {
  isValid?: (t: unknown) => boolean;
  ticketStatuses?: string[];
  throws?: boolean;
}): ExpoLike {
  return {
    isExpoPushToken:
      opts.isValid ?? ((t) => typeof t === 'string' && t.startsWith('ExponentPushToken[')),
    chunkPushNotifications: (m) => [m],
    sendPushNotificationsAsync: vi.fn(() => {
      if (opts.throws) return Promise.reject(new Error('network'));
      return Promise.resolve((opts.ticketStatuses ?? []).map((status) => ({ status })));
    }),
  };
}
const VALID_TOKEN = 'ExponentPushToken[abc123]';
describe('@fleet/api - ExpoPushProvider (integration)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
  });
  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });
  it('returns rejected=1 when operator has no tokens', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const p = new ExpoPushProvider(tx as never, fakeExpo({}));
      expect(await p.sendToOperator(OPERATOR_ID, { title: 't', body: 'b' })).toEqual({
        accepted: 0,
        rejected: 1,
      });
    });
  });
  it('returns rejected when operator has only invalid tokens', async () => {
    await withTxIsolation(testDb, async (tx) => {
      await seedTokens(tx, ['not-a-token', null]);
      const p = new ExpoPushProvider(tx as never, fakeExpo({}));
      const r = await p.sendToOperator(OPERATOR_ID, { title: 't', body: 'b' });
      expect(r.accepted).toBe(0);
      expect(r.rejected).toBeGreaterThan(0);
    });
  });
  it('counts ok tickets as accepted', async () => {
    await withTxIsolation(testDb, async (tx) => {
      await seedTokens(tx, [VALID_TOKEN]);
      const p = new ExpoPushProvider(tx as never, fakeExpo({ ticketStatuses: ['ok'] }));
      expect(await p.sendToOperator(OPERATOR_ID, { title: 't', body: 'b' })).toEqual({
        accepted: 1,
        rejected: 0,
      });
    });
  });
  it('counts error tickets as rejected', async () => {
    await withTxIsolation(testDb, async (tx) => {
      await seedTokens(tx, [VALID_TOKEN]);
      const p = new ExpoPushProvider(tx as never, fakeExpo({ ticketStatuses: ['error'] }));
      expect(await p.sendToOperator(OPERATOR_ID, { title: 't', body: 'b' })).toEqual({
        accepted: 0,
        rejected: 1,
      });
    });
  });
  it('counts entire chunk as rejected when send throws', async () => {
    await withTxIsolation(testDb, async (tx) => {
      await seedTokens(tx, [VALID_TOKEN, VALID_TOKEN]);
      const p = new ExpoPushProvider(tx as never, fakeExpo({ throws: true }));
      const r = await p.sendToOperator(OPERATOR_ID, { title: 't', body: 'b' });
      expect(r.accepted).toBe(0);
      expect(r.rejected).toBe(2);
    });
  });
  it('handles mixed valid/invalid tokens', async () => {
    await withTxIsolation(testDb, async (tx) => {
      await seedTokens(tx, [VALID_TOKEN, 'bad', null]);
      const p = new ExpoPushProvider(tx as never, fakeExpo({ ticketStatuses: ['ok'] }));
      const r = await p.sendToOperator(OPERATOR_ID, { title: 't', body: 'b' });
      expect(r.accepted).toBe(1);
    });
  });
  it('sets critical-delivery fields on every message: high priority, transport-orders channel, time-sensitive iOS level, custom sound (4AM wake reliability)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      await seedTokens(tx, [VALID_TOKEN]);
      const expo = fakeExpo({ ticketStatuses: ['ok'] });
      const calls = (expo.sendPushNotificationsAsync as unknown as { mock: { calls: unknown[][] } })
        .mock.calls;
      const p = new ExpoPushProvider(tx as never, expo);
      await p.sendToOperator(OPERATOR_ID, { title: 't', body: 'b' });
      const sent = calls[0]?.[0] as Record<string, unknown>[];
      const msg = sent[0] ?? {};
      expect(msg['priority']).toBe('high');
      expect(msg['channelId']).toBe('transport-orders-v1');
      expect(msg['interruptionLevel']).toBe('time-sensitive');
      expect(msg['sound']).toBe('transport_alert.wav');
    });
  });
  it('attaches body.data to the Expo message when provided (covers line 55 branch)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      await seedTokens(tx, [VALID_TOKEN]);
      const expo = fakeExpo({ ticketStatuses: ['ok'] });
      const calls = (expo.sendPushNotificationsAsync as unknown as { mock: { calls: unknown[][] } })
        .mock.calls;
      const p = new ExpoPushProvider(tx as never, expo);
      const r = await p.sendToOperator(OPERATOR_ID, {
        title: 't',
        body: 'b',
        data: { kind: 'cmd', id: '7' },
      });
      expect(r).toEqual({ accepted: 1, rejected: 0 });
      const sent = calls[0]?.[0];
      expect(Array.isArray(sent)).toBe(true);
      expect((sent as { data?: unknown }[])[0]?.data).toEqual({ kind: 'cmd', id: '7' });
    });
  });
});
describe('@fleet/api - defaultExpoClient', () => {
  it('returns ExpoLike with all methods', () => {
    const client = defaultExpoClient();
    expect(typeof client.isExpoPushToken).toBe('function');
    expect(typeof client.chunkPushNotifications).toBe('function');
    expect(typeof client.sendPushNotificationsAsync).toBe('function');
  });
  it('isExpoPushToken validates real tokens via Expo SDK', () => {
    const client = defaultExpoClient();
    expect(client.isExpoPushToken('ExponentPushToken[abc]')).toBe(true);
    expect(client.isExpoPushToken('not-a-real-token')).toBe(false);
  });
  it('chunkPushNotifications delegates to the real Expo client and returns batched arrays', () => {
    const client = defaultExpoClient();
    const messages = [
      { to: 'ExponentPushToken[a]', title: 't', body: 'b' },
      { to: 'ExponentPushToken[b]', title: 't', body: 'b' },
    ];
    const chunks = client.chunkPushNotifications(messages);
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.flat()).toHaveLength(messages.length);
    expect(chunks.every((c) => Array.isArray(c))).toBe(true);
  });
  it('sendPushNotificationsAsync maps the SDK push tickets to {status} (no network)', async () => {
    // defaultExpoClient wraps the real expo-server-sdk Expo client, whose
    // sendPushNotificationsAsync POSTs to https://exp.host. A unit test must never hit
    // the real network (offline/CI -> EAI_AGAIN, non-deterministic, slow). The logic that
    // belongs to US — and is worth testing — is the mapping tickets.map(t => ({ status:
    // t.status })). So we spy on the SDK collaborator method (Expo.prototype
    // .sendPushNotificationsAsync) to return a controlled ExpoPushTicket array matching the
    // SDK documented success-ticket shape ({ status: 'ok', id }), and assert our mapping.
    // isExpoPushToken / chunkPushNotifications remain the REAL SDK in the tests above.
    const sendSpy = vi
      .spyOn(Expo.prototype, 'sendPushNotificationsAsync')
      .mockResolvedValue([{ status: 'ok', id: 'ticket-1' }]);
    try {
      const client = defaultExpoClient();
      const tickets = await client.sendPushNotificationsAsync([
        { to: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', title: 't', body: 'b' },
      ]);
      expect(Array.isArray(tickets)).toBe(true);
      expect(tickets).toHaveLength(1);
      expect(tickets[0]?.status).toBe('ok');
      // mapping must project ONLY { status } — the receipt id is intentionally dropped.
      expect(Object.keys(tickets[0] ?? {})).toEqual(['status']);
      expect(sendSpy).toHaveBeenCalledTimes(1);
    } finally {
      sendSpy.mockRestore();
    }
  });
});

describe('@fleet/api - driver alert channel contract constants', () => {
  it('exports the versioned Android channel id', () => {
    expect(DRIVER_ALERT_ANDROID_CHANNEL_ID).toBe('transport-orders-v1');
  });
  it('exports the custom alarm sound filename', () => {
    expect(DRIVER_ALERT_SOUND).toBe('transport_alert.wav');
  });
  it('exports a strong vibration pattern as [wait, buzz, ...] ms pairs, distinct from ordinary notifications', () => {
    expect(Array.isArray(DRIVER_ALERT_VIBRATION_PATTERN)).toBe(true);
    expect(DRIVER_ALERT_VIBRATION_PATTERN.length).toBeGreaterThanOrEqual(4);
    expect(DRIVER_ALERT_VIBRATION_PATTERN.every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
    expect(Math.max(...DRIVER_ALERT_VIBRATION_PATTERN)).toBeGreaterThanOrEqual(400);
  });
});
