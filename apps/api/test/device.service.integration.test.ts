// apps/api/test/device.service.integration.test.ts
// Integration tests with real Postgres via Testcontainers.
// Verifies: DB-level unique partial index catches concurrent issueSession races
// that mock tests cannot detect.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { ConflictException } from '@nestjs/common';
import { DeviceService, type IssueSessionInput } from '../src/device/device.service.js';
import * as schema from '../src/database/schema/index.js';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let service: DeviceService;

const TENANT = {
  companyId: '00000000-0000-0000-0000-000000000003',
  businessUnitId: '00000000-0000-0000-0000-000000000004',
  depotId: '00000000-0000-0000-0000-000000000005',
  legalEntityId: '00000000-0000-0000-0000-000000000006',
};

async function applySchema(d: NodePgDatabase<typeof schema>): Promise<void> {
  // Minimal schema bootstrap: create only the tables the test needs.
  // Real migrations land Week 3+ via drizzle-kit.
  await d.execute(sql`
    CREATE TABLE device_registry (
      device_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL,
      business_unit_id UUID NOT NULL,
      depot_id UUID NOT NULL,
      legal_entity_id UUID NOT NULL,
      operator_id UUID NOT NULL,
      platform VARCHAR(32) NOT NULL,
      app_version VARCHAR(32) NOT NULL,
      enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ
    )
  `);
  await d.execute(sql`
    CREATE TABLE device_session (
      device_session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL,
      business_unit_id UUID NOT NULL,
      depot_id UUID NOT NULL,
      legal_entity_id UUID NOT NULL,
      device_id UUID NOT NULL REFERENCES device_registry(device_id),
      operator_id UUID NOT NULL,
      surface VARCHAR(16) NOT NULL,
      session_mode VARCHAR(16) NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      revocation_reason VARCHAR(64),
      revocation_reason_schema_version UUID,
      token_consumed_at TIMESTAMPTZ
    )
  `);
  await d.execute(sql`
    CREATE UNIQUE INDEX device_session_one_mutating_per_operator_surface_uq
    ON device_session (operator_id, surface)
    WHERE session_mode = 'mutating' AND revoked_at IS NULL
  `);
}

async function seedDevice(d: NodePgDatabase<typeof schema>, deviceId: string, operatorId: string): Promise<void> {
  await d.execute(sql`
    INSERT INTO device_registry (device_id, company_id, business_unit_id, depot_id, legal_entity_id, operator_id, platform, app_version)
    VALUES (${deviceId}::uuid, ${TENANT.companyId}::uuid, ${TENANT.businessUnitId}::uuid, ${TENANT.depotId}::uuid, ${TENANT.legalEntityId}::uuid, ${operatorId}::uuid, 'ios', '0.1.0')
  `);
}

describe('@fleet/api - DeviceService (integration)', () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('fleet_test')
      .start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    db = drizzle(pool, { schema, casing: 'snake_case' });
    await applySchema(db);
    service = new DeviceService(db);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE device_session, device_registry CASCADE`);
  });

  it('issues a mutating session against real Postgres', async () => {
    const deviceId = '00000000-0000-0000-0000-000000000001';
    const operatorId = '00000000-0000-0000-0000-000000000002';
    await seedDevice(db, deviceId, operatorId);

    const input: IssueSessionInput = {
      deviceId, operatorId, surface: 'road', sessionMode: 'mutating', ...TENANT,
    };
    const result = await service.issueSession(input);
    expect(result.surface).toBe('road');
    expect(result.revokedAt).toBeNull();
  });

  it('rejects second concurrent mutating session via DB unique constraint', async () => {
    const deviceId = '00000000-0000-0000-0000-000000000001';
    const operatorId = '00000000-0000-0000-0000-000000000002';
    await seedDevice(db, deviceId, operatorId);

    const input: IssueSessionInput = {
      deviceId, operatorId, surface: 'road', sessionMode: 'mutating', ...TENANT,
    };

    // Fire two concurrent issues — one must win, one must lose with ConflictException.
    const results = await Promise.allSettled([
      service.issueSession(input),
      service.issueSession(input),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const failure = rejected[0];
    if (failure?.status !== 'rejected') throw new Error('expected rejection');
    expect(failure.reason).toBeInstanceOf(ConflictException);
  });

  it('allows new mutating session after previous is revoked', async () => {
    const deviceId = '00000000-0000-0000-0000-000000000001';
    const operatorId = '00000000-0000-0000-0000-000000000002';
    await seedDevice(db, deviceId, operatorId);

    const input: IssueSessionInput = {
      deviceId, operatorId, surface: 'road', sessionMode: 'mutating', ...TENANT,
    };
    const first = await service.issueSession(input);
    await service.revokeSession(first.deviceSessionId, 'admin_revoke');
    const second = await service.issueSession(input);
    expect(second.deviceSessionId).not.toBe(first.deviceSessionId);
  });

  it('allows multiple shadow sessions for same operator+surface', async () => {
    const deviceId = '00000000-0000-0000-0000-000000000001';
    const operatorId = '00000000-0000-0000-0000-000000000002';
    await seedDevice(db, deviceId, operatorId);

    const input: IssueSessionInput = {
      deviceId, operatorId, surface: 'road', sessionMode: 'shadow', ...TENANT,
    };
    await service.issueSession(input);
    await expect(service.issueSession(input)).resolves.toBeDefined();
  });

  it('revokeSession is idempotent against real DB', async () => {
    const deviceId = '00000000-0000-0000-0000-000000000001';
    const operatorId = '00000000-0000-0000-0000-000000000002';
    await seedDevice(db, deviceId, operatorId);

    const issued = await service.issueSession({
      deviceId, operatorId, surface: 'road', sessionMode: 'mutating', ...TENANT,
    });
    const first = await service.revokeSession(issued.deviceSessionId, 'admin_revoke');
    const second = await service.revokeSession(issued.deviceSessionId, 'shift_end');
    expect(first.revocationReason).toBe('admin_revoke');
    expect(second.revocationReason).toBe('admin_revoke'); // unchanged - idempotent
  });
});
