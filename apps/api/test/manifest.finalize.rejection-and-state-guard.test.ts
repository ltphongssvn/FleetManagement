// apps/api/test/manifest.finalize.rejection-and-state-guard.test.ts
// RED tests for two issues:
// #3: transitionManifest must verify .returning() — silent no-op when manifest in terminal state.
// #5: rejected manifests must emit audit event for observability.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ManifestService } from '../src/manifest/manifest.service.js';
import { ManifestStateInvalidTransitionError } from '../src/manifest/manifest.errors.js';
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
    key: `manifests/co/${randomUUID()}/x.jpg`,
    bucket: 'fleet-test',
    expiresAt: new Date('2026-04-27T20:00:00Z'),
  } satisfies PresignedUpload))};
}
function fakeConfig(): ConfigService<Env, true> {
  return { getOrThrow: vi.fn().mockReturnValue(900) } as unknown as ConfigService<Env, true>;
}

async function setupVerifyingSession(transportOrderId: string, correlationId: string): Promise<string> {
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

describe('@fleet/api - finalizeIntake state guard + rejection audit', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_fin'); });
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    service = new ManifestService(testDb.db, fakeBlobStore(), fakeConfig());
    await truncateAllTables(testDb.db);
  });

  it('#3: throws ManifestStateInvalidTransitionError when manifest already in terminal state', async () => {
    const sessionId = await setupVerifyingSession(randomUUID(), randomUUID());
    // Force the manifest into terminal state out-of-band (simulating a race with another worker).
    await testDb.db.execute(sql`UPDATE manifest SET state = 'committed'`);
    // The upload_session is still 'verifying'; finalizeIntake would silently no-op the manifest update.
    await expect(
      service.finalizeIntake({ uploadSessionId: sessionId, accepted: true }, OP),
    ).rejects.toBeInstanceOf(ManifestStateInvalidTransitionError);
  });

  it('#5: rejected manifest emits audit + sync_change_feed events (no ERP outbox)', async () => {
    const sessionId = await setupVerifyingSession(randomUUID(), randomUUID());
    await service.finalizeIntake({ uploadSessionId: sessionId, accepted: false, rejectionReasonCode: 'blurred_image' }, OP);

    const audit = await testDb.db.execute<{ count: string; event_type: string }>(sql`
      SELECT COUNT(*)::text AS count, MAX(event_type) AS event_type FROM fleet_audit_log
    `);
    expect(audit.rows[0]?.count).toBe('1');
    expect(audit.rows[0]?.event_type).toBe('manifest.rejected');

    const feed = await testDb.db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count FROM sync_change_feed WHERE aggregate_type = 'manifest'
    `);
    expect(feed.rows[0]?.count).toBe('1');

    // Rejection MUST NOT enqueue ERP outbox row (only accepted manifests go to ERP).
    const erpOutbox = await testDb.db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count FROM outbox WHERE queue_name = 'erp'
    `);
    expect(erpOutbox.rows[0]?.count).toBe('0');
  }, 60_000);
});
