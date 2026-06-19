// apps/api/test/manifest.determinism-seam.integration.test.ts
// Integration proof (real Postgres via Testcontainers) that ManifestService sources
// committed-state timestamps from the injected Clock and tri-write actionIds from the
// injected IdGenerator — the determinism seam (common/clock.ts + common/id-generator.ts).
// Mirrors the existing manifest integration harness. finalizeIntake(accepted=true)
// commits the manifest (committed_at) and emits a tri-write (sync_change_feed/audit
// action_id), so fixed fakes make both columns deterministic.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ManifestService } from '../src/manifest/manifest.service.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import type { IBlobStore, PresignedUpload } from '../src/storage/storage-provider.interface.js';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../src/config/env.config.js';
import type { Clock } from '../src/common/clock.js';
import type { IdGenerator } from '../src/common/id-generator.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb, truncateAllTables } from './helpers/migrate-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: MigratedTestDb;
let service: ManifestService;
const OP: OperatorContext = createOperatorContext();

const FIXED_AT = new Date('2031-05-06T07:08:09.000Z');
const FIXED_ID = '22222222-2222-4222-8222-222222222222';
const fixedClock: Clock = { now: () => FIXED_AT };
const fixedIds: IdGenerator = { uuid: () => FIXED_ID };

function fakeBlobStore(): IBlobStore {
  return { presignUpload: vi.fn().mockImplementation(() => Promise.resolve({
    url: 'https://s3.example/presigned',
    key: 'manifests/co/' + randomUUID() + '/x.jpg',
    bucket: 'fleet-test',
    expiresAt: new Date('2031-05-06T07:00:00Z'),
  } satisfies PresignedUpload)) };
}
function fakeConfig(): ConfigService<Env, true> {
  return { getOrThrow: vi.fn().mockReturnValue(900) } as unknown as ConfigService<Env, true>;
}

async function negotiateCommitFinalize(): Promise<void> {
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
  await service.finalizeIntake({ uploadSessionId: negotiated.uploadSessionId, accepted: true }, OP);
}

describe('@fleet/api - ManifestService determinism seam (integration)', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_determinism_seam'); }, 90_000);
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    // 4th/5th args = the injected ports; 3-arg callers elsewhere still default to System*.
    service = new ManifestService(testDb.db, fakeBlobStore(), fakeConfig(), fixedClock, fixedIds);
    await truncateAllTables(testDb.db);
  });

  it('committed manifest.committed_at comes from the injected Clock', async () => {
    await negotiateCommitFinalize();
    const rows = await testDb.db.execute<{ committed_at: string }>(sql`
      SELECT committed_at FROM manifest WHERE state = 'committed' LIMIT 1
    `);
    const committedAt = rows.rows[0]?.committed_at;
    if (committedAt === undefined) throw new Error('no committed manifest row');
    expect(new Date(committedAt).toISOString()).toBe(FIXED_AT.toISOString());
  }, 60_000);

  it('tri-write action_id (sync_change_feed + audit) comes from the injected IdGenerator', async () => {
    await negotiateCommitFinalize();
    // sync_change_feed has no event_type column; the manifest.committed tri-write is
    // the one with aggregate_type='manifest'. fleet_audit_log carries event_type and
    // shares the same action_id via server_seq, so a join cross-checks both paths.
    const feed = await testDb.db.execute<{ action_id: string }>(sql`
      SELECT action_id FROM sync_change_feed WHERE aggregate_type = 'manifest' LIMIT 1
    `);
    expect(feed.rows[0]?.action_id).toBe(FIXED_ID);
    const audit = await testDb.db.execute<{ event_type: string }>(sql`
      SELECT a.event_type FROM fleet_audit_log a
      JOIN sync_change_feed f ON f.server_seq = a.server_seq
      WHERE f.action_id = ${FIXED_ID} AND a.aggregate_type = 'manifest' LIMIT 1
    `);
    expect(audit.rows[0]?.event_type).toBe('manifest.committed');
  }, 60_000);
});
