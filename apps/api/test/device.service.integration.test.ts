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
import { DeviceService } from '../src/device/device.service.js';
import * as schema from '../src/database/schema/index.js';
import { TEST_TENANT, TEST_DEVICE_ID, TEST_OPERATOR_ID, makeIssueInput } from './fixtures/device.fixtures.js';

// Pin to specific minor version - 'postgres:16-alpine' floats and risks CI drift.
const POSTGRES_IMAGE = 'postgres:16.4-alpine3.20';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let service: DeviceService;

async function applySchema(d: NodePgDatabase<typeof schema>): Promise<void> {
  // Raw SQL placeholder - replaced by drizzle-kit migrate(d, { migrationsFolder })
  // when migrations land Week 3+.
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
    VALUES (${deviceId}::uuid, ${TEST_TENANT.companyId}::uuid, ${TEST_TENANT.businessUnitId}::uuid, ${TEST_TENANT.depotId}::uuid, ${TEST_TENANT.legalEntityId}::uuid, ${operatorId}::uuid, 'ios', '0.1.0')
  `);
}

describe('@fleet/api - DeviceService (integration)', () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase('fleet_test')
      .withReuse()
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
    // Dynamic truncate: future-proof against new tables.
    await db.execute(sql`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema())
        LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
  });

  describe('issueSession', () => {
    it('issues a mutating session against real Postgres', async () => {
      await seedDevice(db, TEST_DEVICE_ID, TEST_OPERATOR_ID);
      const result = await service.issueSession(makeIssueInput());
      expect(result.surface).toBe('road');
      expect(result.revokedAt).toBeNull();
    });

    it('rejects second concurrent mutating session via DB unique constraint', async () => {
      await seedDevice(db, TEST_DEVICE_ID, TEST_OPERATOR_ID);
      const input = makeIssueInput();
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
      await seedDevice(db, TEST_DEVICE_ID, TEST_OPERATOR_ID);
      const input = makeIssueInput();
      const first = await service.issueSession(input);
      await service.revokeSession(first.deviceSessionId, 'admin_revoke');
      const second = await service.issueSession(input);
      expect(second.deviceSessionId).not.toBe(first.deviceSessionId);
    });

    it('rejects issueSession with unregistered deviceId via FK violation', async () => {
      // No seedDevice call - device does not exist in registry.
      await expect(service.issueSession(makeIssueInput())).rejects.toThrow();
    });

    it('allows multiple shadow sessions for same operator+surface', async () => {
      await seedDevice(db, TEST_DEVICE_ID, TEST_OPERATOR_ID);
      const input = makeIssueInput({ sessionMode: 'shadow' });
      await service.issueSession(input);
      await expect(service.issueSession(input)).resolves.toBeDefined();
    });
  });

  describe('revokeSession', () => {
    it('is idempotent against real DB', async () => {
      await seedDevice(db, TEST_DEVICE_ID, TEST_OPERATOR_ID);
      const issued = await service.issueSession(makeIssueInput());
      const first = await service.revokeSession(issued.deviceSessionId, 'admin_revoke');
      const second = await service.revokeSession(issued.deviceSessionId, 'shift_end');
      expect(first.revocationReason).toBe('admin_revoke');
      expect(second.revocationReason).toBe('admin_revoke');
    });
  });

  describe('findActiveSession', () => {
    it('returns the row when an active session exists', async () => {
      await seedDevice(db, TEST_DEVICE_ID, TEST_OPERATOR_ID);
      const issued = await service.issueSession(makeIssueInput());
      const found = await service.findActiveSession(issued.deviceSessionId);
      expect(found?.deviceSessionId).toBe(issued.deviceSessionId);
    });

    it('returns null after the session is revoked', async () => {
      await seedDevice(db, TEST_DEVICE_ID, TEST_OPERATOR_ID);
      const issued = await service.issueSession(makeIssueInput());
      await service.revokeSession(issued.deviceSessionId, 'admin_revoke');
      expect(await service.findActiveSession(issued.deviceSessionId)).toBeNull();
    });
  });

  describe('deviceExists', () => {
    it('returns true for registered devices', async () => {
      await seedDevice(db, TEST_DEVICE_ID, TEST_OPERATOR_ID);
      expect(await service.deviceExists(TEST_DEVICE_ID)).toBe(true);
    });

    it('returns false for unknown devices', async () => {
      expect(await service.deviceExists('00000000-0000-0000-0000-0000000000ff')).toBe(false);
    });
  });
});
