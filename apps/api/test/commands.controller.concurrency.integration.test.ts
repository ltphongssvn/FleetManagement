// apps/api/test/commands.controller.concurrency.integration.test.ts
// RED test: proves the MAX(server_seq) race in CommandsController.issue().
// Concurrent commands for the same company MUST produce distinct, monotonic
// server_seq values. Today's MAX()+1 pattern allows duplicates under load.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { CommandsController } from '../src/commands/commands.controller.js';
import { CommandsGateway } from '../src/commands/commands.gateway.js';
import { CommandsService } from '../src/commands/commands.service.js';
import { TenantPolicy } from '../src/auth/tenant-policy.js';
import type { IPushProvider } from '../src/push/push-provider.interface.js';
import type { Clock } from '../src/common/clock.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb } from './helpers/migrate-test-db.js';
import { rowsOf } from './helpers/integration-rows.js';

let testDb: MigratedTestDb;

const COMPANY = '00000000-0000-0000-0000-0000000000a1';
const BU = '00000000-0000-0000-0000-0000000000a2';
const DEPOT = '00000000-0000-0000-0000-0000000000a3';
const LE = '00000000-0000-0000-0000-0000000000a4';
const OP = '00000000-0000-0000-0000-0000000000a5';

const opCtx: OperatorContext = {
  operatorId: OP,
  companyId: COMPANY,
  businessUnitId: BU,
  depotId: DEPOT,
  legalEntityId: LE,
};

function makeController(): CommandsController {
  const noopPush: IPushProvider['sendToOperator'] = () => Promise.resolve({ accepted: 0, rejected: 0 });
  const clock: Clock = { now: () => new Date('2026-05-02T10:00:00.000Z') };
  const gateway = new CommandsGateway({ sendToOperator: noopPush }, clock);
  // Stub Socket.IO server: pushCommand only reads sockets.adapter.rooms.get + .to().emit().
  const fakeServer = {
    sockets: { adapter: { rooms: new Map<string, Set<string>>() } },
    to: () => ({ emit: () => undefined }),
  };
  Object.assign(gateway as unknown as { server: unknown }, { server: fakeServer });
  const service = new (CommandsService as unknown as new (db: unknown) => CommandsService)(testDb.db);
  const policy = new (TenantPolicy as unknown as new (db: unknown) => TenantPolicy)(testDb.db);
  return new CommandsController(gateway, service, policy);
}

function cmd(commandId: string): unknown {
  return {
    commandId,
    aggregateType: 'road_run',
    aggregateId: '00000000-0000-0000-0000-0000000000b1',
    type: 'assign_run',
    payload: { note: 'concurrency-probe' },
    targetOperatorId: OP,
    issuedAt: '2026-05-02T10:00:00.000Z',
  };
}

describe('@fleet/api - CommandsController concurrency (integration, RED)', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_cmd_concurrency'); });
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    await testDb.db.execute(sql`TRUNCATE TABLE sync_change_feed, fleet_audit_log, outbox, device_registry, road_run CASCADE`);
    await testDb.db.execute(sql`
      INSERT INTO device_registry (device_id, company_id, business_unit_id, depot_id, legal_entity_id, operator_id, platform, app_version)
      VALUES (gen_random_uuid(), ${COMPANY}, ${BU}, ${DEPOT}, ${LE}, ${OP}, 'ios', '1.0')
    `);
    // Seed the single aggregate used by all tests' cmd() helper.
    await testDb.db.execute(sql`
      INSERT INTO road_run (road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, assigned_operator_id, assigned_asset_id)
      VALUES ('00000000-0000-0000-0000-0000000000b1'::uuid, ${COMPANY}, ${BU}, ${DEPOT}, ${LE}, 'planned', '00000000-0000-0000-0000-0000aaaaaa01'::uuid, '00000000-0000-0000-0000-0000bbbbbb02'::uuid)
    `);
  });

  it('assigns DISTINCT server_seq values to N concurrent commands for same company', async () => {
    const N = 20;
    const ctrl = makeController();
    const ids = Array.from({ length: N }, (_, i) =>
      `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );

    const results = await Promise.allSettled(
      ids.map((id) => ctrl.issue(cmd(id), opCtx)),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    expect(fulfilled).toBe(N);

    const rows = await testDb.db.execute(
      sql`SELECT server_seq FROM sync_change_feed WHERE company_id = ${COMPANY} ORDER BY server_seq`,
    );
    const seqs = rowsOf<{ server_seq: string | number | bigint }>(
      rows as unknown as { rows: readonly { server_seq: string | number | bigint }[] },
    ).map((r) => BigInt(r.server_seq));

    expect(seqs.length).toBe(N);
    const distinct = new Set(seqs.map((s) => s.toString()));
    expect(distinct.size).toBe(N);

    for (let i = 1; i < seqs.length; i += 1) {
      const prev = seqs[i - 1];
      const cur = seqs[i];
      if (prev === undefined || cur === undefined) throw new Error('seq undefined');
      expect(cur > prev).toBe(true);
    }
  });

  it('returns idempotent success on duplicate commandId (replay) without throwing', async () => {
    const ctrl = makeController();
    const dupCmd = cmd('00000000-0000-0000-0000-0000000000d1') as { commandId: string };

    const first = await ctrl.issue(dupCmd, opCtx);
    expect(first.commandId).toBe('00000000-0000-0000-0000-0000000000d1');

    // Replay: same commandId; must NOT throw, must return success shape.
    const second = await ctrl.issue(dupCmd, opCtx);
    expect(second.commandId).toBe('00000000-0000-0000-0000-0000000000d1');

    // Side-effect contract: only ONE row in each append path (no duplicate
    // audit/outbox emission on replay).
    const feed = await testDb.db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM sync_change_feed WHERE action_id = ${dupCmd.commandId}`,
    );
    expect(feed.rows[0]?.count).toBe('1');
    const audit = await testDb.db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM fleet_audit_log WHERE payload->>'commandId' = ${dupCmd.commandId}`,
    );
    expect(audit.rows[0]?.count).toBe('1');
    const ob = await testDb.db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM outbox WHERE payload->>'commandId' = ${dupCmd.commandId}`,
    );
    expect(ob.rows[0]?.count).toBe('1');
  });
});
