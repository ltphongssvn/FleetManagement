// apps/api/test/manifest.commit-finalize.parallel.test.ts
// Parallel-call regression coverage for #2 + #3 critique:
//   - two concurrent commitUpload calls for same uploadSessionId
//   - two concurrent finalizeIntake calls for same verifying session
// Both must end with exactly one winner per Postgres MVCC + inArray() guard.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ManifestService } from '../src/manifest/manifest.service.js';
import {
  UploadSessionInvalidStateError,
  ManifestStateInvalidTransitionError,
  UploadSessionNotFoundError,
} from '../src/manifest/manifest.errors.js';
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

async function setupVerifyingSession(): Promise<string> {
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

async function setupInitiatedSession(): Promise<string> {
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
  return negotiated.uploadSessionId;
}

describe('@fleet/api - parallel commit/finalize regression', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_par'); });
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    service = new ManifestService(testDb.db, fakeBlobStore(), fakeConfig());
    await truncateAllTables(testDb.db);
  });

  it('#2: two concurrent commitUpload calls -> exactly one wins, other gets UploadSessionInvalidStateError', async () => {
    const sessionId = await setupInitiatedSession();
    const results = await Promise.allSettled([
      service.commitUpload({ uploadSessionId: sessionId, actualSizeBytes: 900 }, OP),
      service.commitUpload({ uploadSessionId: sessionId, actualSizeBytes: 900 }, OP),
    ]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const first = rejected[0];
    if (first === undefined) throw new Error('expected one rejected promise');
    const reason: unknown = first.reason;
    expect(
      reason instanceof UploadSessionInvalidStateError ||
      reason instanceof UploadSessionNotFoundError,
    ).toBe(true);

    const finalState = await testDb.db.execute<{ state: string }>(sql`
      SELECT state FROM upload_session WHERE upload_session_id = ${sessionId}::uuid
    `);
    expect(finalState.rows[0]?.state).toBe('verifying');
  });

  it('#3: two concurrent finalizeIntake calls -> exactly one wins, other gets a state-guard error', async () => {
    const sessionId = await setupVerifyingSession();
    const results = await Promise.allSettled([
      service.finalizeIntake({ uploadSessionId: sessionId, accepted: true }, OP),
      service.finalizeIntake({ uploadSessionId: sessionId, accepted: true }, OP),
    ]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const first = rejected[0];
    if (first === undefined) throw new Error('expected one rejected promise');
    const reason: unknown = first.reason;
    expect(
      reason instanceof UploadSessionNotFoundError ||
      reason instanceof UploadSessionInvalidStateError ||
      reason instanceof ManifestStateInvalidTransitionError,
    ).toBe(true);

    const finalState = await testDb.db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count FROM fleet_audit_log WHERE event_type = 'manifest.committed'
    `);
    expect(finalState.rows[0]?.count).toBe('1');
  }, 60_000);
});
