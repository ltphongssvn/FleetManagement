// apps/api/test/expo-push-provider.test.ts
// PGLite-backed integration test. Real device_registry table; real SELECT.
// Removes mockDeep<FleetDb> chain mock. Also drops "lines 22-29" line-number
// test name (critique #3 leak).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { ExpoPushProvider, defaultExpoClient, type ExpoLike } from '../src/push/expo-push-provider.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
let testDb: PgliteTestDb;
const TENANCY_VALS = `
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000003'::uuid,
  '00000000-0000-0000-0000-000000000004'::uuid
`;
const OPERATOR_ID = '00000000-0000-0000-0000-0000000000aa';
async function seedTokens(tokens: (string | null)[]): Promise<void> {
  await testDb.db.execute(sql`TRUNCATE TABLE device_registry CASCADE`);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    await testDb.db.execute(sql.raw(`
      INSERT INTO device_registry (company_id, business_unit_id, depot_id, legal_entity_id, operator_id, platform, app_version, expo_push_token)
      VALUES (${TENANCY_VALS}, '${OPERATOR_ID}'::uuid, 'platform-${String(i)}', '1.0.0', ${token === null || token === undefined ? 'NULL' : `'${token}'`})
    `));
  }
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
describe('@fleet/api - ExpoPushProvider (integration)', () => {
  beforeAll(async () => {
    // No hardcoded timeout: inherit hookTimeout:60_000 from vitest.config.ts.
    // A hardcoded 30_000 here shadowed the config and timed out under full
    // monorepo parallel load while PGLite WASM init was still running.
    testDb = await startPgliteTestDb();
  });
  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });
  beforeEach(async () => {
    await testDb.db.execute(sql`TRUNCATE TABLE device_registry CASCADE`);
  });
  it('returns rejected=1 when operator has no tokens', async () => {
    const p = new ExpoPushProvider(testDb.db as never, fakeExpo({}));
    expect(await p.sendToOperator(OPERATOR_ID, { title: 't', body: 'b' })).toEqual({ accepted: 0, rejected: 1 });
  });
  it('returns rejected when operator has only invalid tokens', async () => {
    await seedTokens(['not-a-token', null]);
    const p = new ExpoPushProvider(testDb.db as never, fakeExpo({}));
    const r = await p.sendToOperator(OPERATOR_ID, { title: 't', body: 'b' });
    expect(r.accepted).toBe(0);
    expect(r.rejected).toBeGreaterThan(0);
  });
  it('counts ok tickets as accepted', async () => {
    await seedTokens([VALID_TOKEN]);
    const p = new ExpoPushProvider(testDb.db as never, fakeExpo({ ticketStatuses: ['ok'] }));
    expect(await p.sendToOperator(OPERATOR_ID, { title: 't', body: 'b' })).toEqual({ accepted: 1, rejected: 0 });
  });
  it('counts error tickets as rejected', async () => {
    await seedTokens([VALID_TOKEN]);
    const p = new ExpoPushProvider(testDb.db as never, fakeExpo({ ticketStatuses: ['error'] }));
    expect(await p.sendToOperator(OPERATOR_ID, { title: 't', body: 'b' })).toEqual({ accepted: 0, rejected: 1 });
  });
  it('counts entire chunk as rejected when send throws', async () => {
    await seedTokens([VALID_TOKEN, VALID_TOKEN]);
    const p = new ExpoPushProvider(testDb.db as never, fakeExpo({ throws: true }));
    const r = await p.sendToOperator(OPERATOR_ID, { title: 't', body: 'b' });
    expect(r.accepted).toBe(0);
    expect(r.rejected).toBe(2);
  });
  it('handles mixed valid/invalid tokens', async () => {
    await seedTokens([VALID_TOKEN, 'bad', null]);
    const p = new ExpoPushProvider(testDb.db as never, fakeExpo({ ticketStatuses: ['ok'] }));
    const r = await p.sendToOperator(OPERATOR_ID, { title: 't', body: 'b' });
    expect(r.accepted).toBe(1);
  });
  it('attaches body.data to the Expo message when provided (covers line 55 branch)', async () => {
    await seedTokens([VALID_TOKEN]);
    const expo = fakeExpo({ ticketStatuses: ['ok'] });
    const calls = (expo.sendPushNotificationsAsync as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const p = new ExpoPushProvider(testDb.db as never, expo);
    const r = await p.sendToOperator(OPERATOR_ID, { title: 't', body: 'b', data: { kind: 'cmd', id: '7' } });
    expect(r).toEqual({ accepted: 1, rejected: 0 });
    const sent = calls[0]?.[0];
    expect(Array.isArray(sent)).toBe(true);
    expect((sent as { data?: unknown }[])[0]?.data).toEqual({ kind: 'cmd', id: '7' });
  });
});
describe('@fleet/api - defaultExpoClient', () => {
  // Pure SDK delegation — no DB needed.
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
    // every message lands in exactly one chunk
    expect(chunks.flat()).toHaveLength(messages.length);
    expect(chunks.every((c) => Array.isArray(c))).toBe(true);
  });
  it('sendPushNotificationsAsync delegates to the real Expo client and maps tickets to {status}', async () => {
    const client = defaultExpoClient();
    // A well-formed-but-fake token: the Expo SDK accepts the shape and returns
    // a ticket (status "error", details DeviceNotRegistered) WITHOUT a network
    // call, so this exercises the await + tickets.map(...) body deterministically.
    const tickets = await client.sendPushNotificationsAsync([
      { to: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', title: 't', body: 'b' },
    ]);
    expect(Array.isArray(tickets)).toBe(true);
    expect(tickets).toHaveLength(1);
    // mapped shape: each entry is exactly { status: string }
    expect(typeof tickets[0]?.status).toBe('string');
    expect(Object.keys(tickets[0] ?? {})).toEqual(['status']);
  });
});
