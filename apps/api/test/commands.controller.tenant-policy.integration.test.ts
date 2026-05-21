// apps/api/test/commands.controller.tenant-policy.test.ts
// Verifies CommandsController rejects cross-tenant targetOperatorId / aggregateId.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { CommandsController } from '../src/commands/commands.controller.js';
import { CommandsGateway } from '../src/commands/commands.gateway.js';
import { CommandsService } from '../src/commands/commands.service.js';
import { TenantPolicy, CrossTenantError } from '../src/auth/tenant-policy.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb } from './helpers/migrate-test-db.js';
import type { OperatorContext } from '../src/auth/operator-context.js';

let testDb: MigratedTestDb;
const COMP_A = '00000000-0000-0000-0000-0000000000a1';
const COMP_B = '00000000-0000-0000-0000-0000000000b1';
const BU = '00000000-0000-0000-0000-0000000000a2';
const DEPOT = '00000000-0000-0000-0000-0000000000a3';
const LE = '00000000-0000-0000-0000-0000000000a4';
const OP_A = '00000000-0000-0000-0000-0000000000a5';
const OP_B = '00000000-0000-0000-0000-0000000000b5';
const RR_B = '00000000-0000-0000-0000-0000000000b9';

const ctxA: OperatorContext = {
  operatorId: OP_A, companyId: COMP_A, businessUnitId: BU, depotId: DEPOT, legalEntityId: LE,
};

function makeCtrl(): CommandsController {
  const noopPush = (): Promise<{ accepted: number; rejected: number }> => Promise.resolve({ accepted: 0, rejected: 0 });
  const gw = new CommandsGateway({ sendToOperator: noopPush }, { now: () => new Date() });
  Object.assign(gw as unknown as { server: unknown }, {
    server: { sockets: { adapter: { rooms: new Map() } }, to: () => ({ emit: () => undefined }) },
  });
  const svc = new (CommandsService as unknown as new (db: unknown) => CommandsService)(testDb.db);
  const policy = new (TenantPolicy as unknown as new (db: unknown) => TenantPolicy)(testDb.db);
  return new CommandsController(gw, svc, policy);
}

const validCmd = (over: Partial<{ targetOperatorId: string; aggregateId: string }> = {}): { commandId: string; type: string; targetOperatorId: string; aggregateType: string; aggregateId: string; payload: Record<string, unknown>; issuedAt: string } => ({
  commandId: '11111111-1111-7111-8111-111111111111',
  type: 'assign_run',
  targetOperatorId: over.targetOperatorId ?? OP_A,
  aggregateType: 'road_run',
  aggregateId: over.aggregateId ?? '22222222-2222-7222-8222-222222222222',
  payload: {},
  issuedAt: '2026-05-02T10:00:00.000Z',
});

describe('@fleet/api - CommandsController tenant policy', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_cmd_tenant'); }, 90_000);
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    await testDb.db.execute(sql`TRUNCATE TABLE device_registry, road_run CASCADE`);
    // Seed operator OP_A in COMP_A
    await testDb.db.execute(sql`
      INSERT INTO device_registry (device_id, company_id, business_unit_id, depot_id, legal_entity_id, operator_id, platform, app_version)
      VALUES (gen_random_uuid(), ${COMP_A}, ${BU}, ${DEPOT}, ${LE}, ${OP_A}, 'ios', '1.0')
    `);
    // Seed operator OP_B in COMP_B (cross-tenant)
    await testDb.db.execute(sql`
      INSERT INTO device_registry (device_id, company_id, business_unit_id, depot_id, legal_entity_id, operator_id, platform, app_version)
      VALUES (gen_random_uuid(), ${COMP_B}, ${BU}, ${DEPOT}, ${LE}, ${OP_B}, 'ios', '1.0')
    `);
    // Seed road_run RR_B in COMP_B
    await testDb.db.execute(sql`
      INSERT INTO road_run (road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, assigned_operator_id, assigned_asset_id)
      VALUES (${RR_B}, ${COMP_B}, ${BU}, ${DEPOT}, ${LE}, 'planned', '00000000-0000-0000-0000-0000aaaaaa01'::uuid, '00000000-0000-0000-0000-0000bbbbbb02'::uuid)
    `);
  });

  it('rejects targetOperatorId from another company', async () => {
    const ctrl = makeCtrl();
    await expect(ctrl.issue(validCmd({ targetOperatorId: OP_B }), ctxA))
      .rejects.toBeInstanceOf(CrossTenantError);
  });

  it('rejects aggregateId (road_run) from another company', async () => {
    const ctrl = makeCtrl();
    await expect(ctrl.issue(validCmd({ aggregateId: RR_B }), ctxA))
      .rejects.toBeInstanceOf(CrossTenantError);
  });

  it('accepts when targetOperator + aggregate both belong to op.companyId', async () => {
    // Seed road_run in COMP_A
    const RR_A = '00000000-0000-0000-0000-0000000000a9';
    await testDb.db.execute(sql`
      INSERT INTO road_run (road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, assigned_operator_id, assigned_asset_id)
      VALUES (${RR_A}, ${COMP_A}, ${BU}, ${DEPOT}, ${LE}, 'planned', '00000000-0000-0000-0000-0000aaaaaa01'::uuid, '00000000-0000-0000-0000-0000bbbbbb02'::uuid)
    `);
    const ctrl = makeCtrl();
    const result = await ctrl.issue(validCmd({ targetOperatorId: OP_A, aggregateId: RR_A }), ctxA);
    expect(result.commandId).toBeDefined();
  });
});
