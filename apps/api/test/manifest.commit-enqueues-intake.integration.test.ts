// apps/api/test/manifest.commit-enqueues-intake.integration.test.ts
// RED-first regression for the production gap where captured manifests stayed
// in 'verifying' forever: commitUpload transitioned the upload_session +
// manifest to 'verifying' but NEVER produced the outbox event that the
// outbox-routing policy maps to the 'intake' queue (manifest_intake.requested
// -> 'intake'). With no intake job enqueued, the worker's intake consumer was
// starved, finalizeIntake was never called, and the road_run completion gate
// (which counts only 'committed' manifests) blocked every driver from
// completing a run. This test asserts the missing side effect: a successful
// commitUpload MUST append exactly one outbox row routed to the intake queue.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ManifestService } from '../src/manifest/manifest.service.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import type { IBlobStore, PresignedUpload } from '../src/storage/storage-provider.interface.js';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../src/config/env.config.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb, truncateAllTables } from './helpers/migrate-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: MigratedTestDb;
let service: ManifestService;
const OP: OperatorContext = createOperatorContext();

function fakeBlobStore(): IBlobStore {
  return { presignUpload: vi.fn().mockImplementation(() => Promise.resolve({
    url: 'https://s3.example/presigned',
    key: 'manifests/co/' + randomUUID() + '/x.jpg',
    bucket: 'fleet-test',
    expiresAt: new Date('2026-04-27T20:00:00Z'),
  } satisfies PresignedUpload))};
}
function fakeConfig(): ConfigService<Env, true> {
  return { getOrThrow: vi.fn().mockReturnValue(900) } as unknown as ConfigService<Env, true>;
}

async function negotiateThenCommit(): Promise<string> {
  const transportOrderId = randomUUID();
  const correlationId = randomUUID();
  await testDb.db.execute(sql`
    INSERT INTO transport_order (transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, state)
    VALUES (${transportOrderId}::uuid, ${OP.companyId}::uuid, ${OP.businessUnitId}::uuid, ${OP.depotId}::uuid, ${OP.legalEntityId}::uuid, 'assigned')
  `);
  const negotiated = await service.negotiateUpload({
    manifestCorrelationId: correlationId, transportOrderId,
    contentType: 'image/jpeg', expectedSizeBytes: 1000,
  }, OP);
  await service.commitUpload({ uploadSessionId: negotiated.uploadSessionId, actualSizeBytes: 900 }, OP);
  return negotiated.uploadSessionId;
}

describe('@fleet/api - commitUpload enqueues intake', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_intake_enq'); }, 90_000);
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    service = new ManifestService(testDb.db, fakeBlobStore(), fakeConfig());
    await truncateAllTables(testDb.db);
  });

  it('produces exactly one outbox row routed to the intake queue after commit', async () => {
    await negotiateThenCommit();
    const rows = await testDb.db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count FROM outbox WHERE queue_name = 'intake'
    `);
    expect(rows.rows[0]?.count).toBe('1');
  }, 60_000);
});
