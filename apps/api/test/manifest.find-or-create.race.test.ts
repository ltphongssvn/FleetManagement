// apps/api/test/manifest.find-or-create.race.test.ts
// Verifies findOrCreateManifest is correct under concurrent first-write.
// Critic claim: tx B's SELECT after onConflictDoNothing sees nothing if A uncommitted.
// PG truth: B's INSERT blocks until A commits; B's SELECT then sees A's row.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ManifestService } from '../src/manifest/manifest.service.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import type { IBlobStore, PresignedUpload } from '../src/storage/storage-provider.interface.js';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../src/config/env.config.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb } from './helpers/migrate-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: MigratedTestDb;
let service: ManifestService;
const OP: OperatorContext = createOperatorContext();

function fakeBlobStore(): IBlobStore {
  return { presignUpload: vi.fn().mockImplementation(() => Promise.resolve({
    url: 'https://s3.example/presigned',
    key: `manifests/co/${randomUUID()}/x.jpg`,
    bucket: 'fleet-test',
    expiresAt: new Date('2026-04-27T20:00:00Z'),
  } satisfies PresignedUpload))};
}
function fakeConfig(): ConfigService<Env, true> {
  return { getOrThrow: vi.fn().mockReturnValue(900) } as unknown as ConfigService<Env, true>;
}

describe('@fleet/api - findOrCreateManifest concurrent first-write', () => {
  beforeAll(async () => {
    testDb = await startMigratedTestDb('fleet_test_foc');
    service = new ManifestService(testDb.db, fakeBlobStore(), fakeConfig());
  }, 90_000);
  afterAll(async () => { await stopMigratedTestDb(testDb); });

  beforeEach(async () => {
    await testDb.db.execute(sql`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename!='__drizzle_migrations')
        LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
  });

  it('two concurrent negotiateUpload with same correlation_id both succeed (no false ManifestInsertFailedError)', async () => {
    const transportOrderId = randomUUID();
    const correlationId = randomUUID();
    await testDb.db.execute(sql`
      INSERT INTO transport_order (transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, state)
      VALUES (${transportOrderId}::uuid, ${OP.companyId}::uuid, ${OP.businessUnitId}::uuid, ${OP.depotId}::uuid, ${OP.legalEntityId}::uuid, 'assigned')
    `);

    const [r1, r2] = await Promise.all([
      service.negotiateUpload({ manifestCorrelationId: correlationId, transportOrderId, contentType: 'image/jpeg', expectedSizeBytes: 1000 }, OP),
      service.negotiateUpload({ manifestCorrelationId: correlationId, transportOrderId, contentType: 'image/jpeg', expectedSizeBytes: 1000 }, OP),
    ]);

    expect(r1.uploadSessionId).toBeDefined();
    expect(r2.uploadSessionId).toBeDefined();
    expect(r1.uploadSessionId).not.toBe(r2.uploadSessionId);

    const cnt = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text AS count FROM manifest`);
    expect(cnt.rows[0]?.count).toBe('1');
  }, 60_000);
});
