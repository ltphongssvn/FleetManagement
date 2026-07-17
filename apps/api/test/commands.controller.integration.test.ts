// apps/api/test/commands.controller.integration.test.ts
// Integration test for CommandsController.issue: verifies 3 append paths
// (fleet_audit_log + sync_change_feed + outbox) per PDF "Command flow".
// PGLite-backed; no DB mocks.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { CommandsController } from '../src/commands/commands.controller.js';
import { CommandsGateway } from '../src/commands/commands.gateway.js';
import { CommandsService } from '../src/commands/commands.service.js';
import { TenantPolicy } from '../src/auth/tenant-policy.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { createOperatorContext, createCommandPayload } from '@fleet/test-fixtures';

let testDb: PgliteTestDb;
let ctrl: CommandsController;
let gateway: CommandsGateway;

const OP = createOperatorContext();

describe('@fleet/api - CommandsController.issue (integration)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
    gateway = new CommandsGateway();
    // Gateway requires Server to push; for HTTP-path test we only need pushCommand
    // to return a result without actually emitting. Stub server with sockets adapter.
    (gateway as unknown as { server: { sockets: { adapter: { rooms: Map<string, Set<string>> } }; to: () => { emit: () => void } } }).server = {
      sockets: { adapter: { rooms: new Map() } },
      to: () => ({ emit: () => undefined }),
    };
    const service = new (CommandsService as unknown as new (db: unknown) => CommandsService)(testDb.db);
    const policy = new (TenantPolicy as unknown as new (db: unknown) => TenantPolicy)(testDb.db);
    ctrl = new CommandsController(gateway, service, policy);
    // Raised 30s -> 120s: under the pre-push 'pnpm -r ... test:coverage' load all
    // workspace packages run coverage concurrently; this suite's beforeAll (PGlite
    // migrations + gateway stub + 3 service constructors) intermittently exceeds
    // 30s on a CPU-contended host (see context/03-testcontainers-hook-timeout).
  });
  afterAll(async () => stopPgliteTestDb(testDb));
  beforeEach(async () => {
    await testDb.db.execute(sql`TRUNCATE TABLE outbox, fleet_audit_log, sync_change_feed, device_registry, road_run CASCADE`);
    // Seed tenancy: operator + road_run in OP.companyId so TenantPolicy passes.
    await testDb.db.execute(sql`
      INSERT INTO device_registry (device_id, company_id, business_unit_id, depot_id, legal_entity_id, operator_id, platform, app_version)
      VALUES (gen_random_uuid(), ${OP.companyId}, ${OP.businessUnitId}, ${OP.depotId}, ${OP.legalEntityId}, ${OP.operatorId}, 'ios', '1.0')
    `);
  });

  it('writes to all three append paths and emits audit row', async () => {
    const cmd = createCommandPayload({ targetOperatorId: OP.operatorId });
    await testDb.db.execute(sql`
      INSERT INTO road_run (road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, assigned_operator_id, assigned_asset_id)
      VALUES (${cmd.aggregateId}::uuid, ${OP.companyId}, ${OP.businessUnitId}, ${OP.depotId}, ${OP.legalEntityId}, 'planned', ${OP.operatorId}::uuid, '00000000-0000-0000-0000-0000bbbbbb02'::uuid)
    `);
    const result = await ctrl.issue(cmd, OP);
    expect(result.commandId).toBe(cmd.commandId);

    const audit = await testDb.db.execute<{ count: string; event_type: string }>(sql`
      SELECT COUNT(*)::text as count, MAX(event_type) as event_type FROM fleet_audit_log
    `);
    expect(audit.rows[0]?.count).toBe('1');
    expect(audit.rows[0]?.event_type).toBe('road_run.command_issued');

    const feed = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM sync_change_feed`);
    expect(feed.rows[0]?.count).toBe('1');

    const ob = await testDb.db.execute<{ count: string; queue_name: string }>(sql`
      SELECT COUNT(*)::text as count, MAX(queue_name) as queue_name FROM outbox
    `);
    expect(ob.rows[0]?.count).toBe('1');
    expect(ob.rows[0]?.queue_name).toBe('projections');
  });

  it('records targetOperatorId in audit payload for traceability', async () => {
    const cmd = createCommandPayload({ targetOperatorId: OP.operatorId });
    await testDb.db.execute(sql`
      INSERT INTO road_run (road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, assigned_operator_id, assigned_asset_id)
      VALUES (${cmd.aggregateId}::uuid, ${OP.companyId}, ${OP.businessUnitId}, ${OP.depotId}, ${OP.legalEntityId}, 'planned', ${OP.operatorId}::uuid, '00000000-0000-0000-0000-0000bbbbbb02'::uuid)
    `);
    await ctrl.issue(cmd, OP);
    const r = await testDb.db.execute<{ payload: { targetOperatorId: string } }>(sql`
      SELECT payload FROM fleet_audit_log LIMIT 1
    `);
    expect(r.rows[0]?.payload.targetOperatorId).toBe(OP.operatorId);
  });
});
