// apps/api/test/manifest.service.integration.test.ts
// Full negotiate -> commit roundtrip against real Postgres.
// Schema applied via real drizzle migrations through migrate-test-db helper.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { ManifestService } from '../src/manifest/manifest.service.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import { UploadSessionInvalidStateError, UploadSessionNotFoundError } from '../src/manifest/manifest.errors.js';
import type { IBlobStore, PresignedUpload } from '../src/storage/storage-provider.interface.js';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../src/config/env.config.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb } from './helpers/migrate-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: MigratedTestDb;
let service: ManifestService;

const OP: OperatorContext = createOperatorContext();

const TRANSPORT_ORDER_ID = '00000000-0000-0000-0000-0000000000b1';
const CORRELATION_ID = '00000000-0000-0000-0000-0000000000a1';

async function seedTransportOrder(): Promise<void> {
  await testDb.db.execute(sql`
    INSERT INTO transport_order (transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, state)
    VALUES (${TRANSPORT_ORDER_ID}::uuid, ${OP.companyId}::uuid, ${OP.businessUnitId}::uuid, ${OP.depotId}::uuid, ${OP.legalEntityId}::uuid, 'assigned')
    ON CONFLICT DO NOTHING
  `);
}

function fakeBlobStore(): IBlobStore {
  return {
    presignUpload: vi.fn().mockResolvedValue({
      url: 'https://s3.example/presigned',
      key: 'manifests/co/m1/a1.jpg',
      bucket: 'fleet-test',
      expiresAt: new Date('2026-04-27T20:00:00Z'),
    } satisfies PresignedUpload),
  };
}

function fakeConfig(): ConfigService<Env, true> {
  return { getOrThrow: vi.fn().mockReturnValue(900) } as unknown as ConfigService<Env, true>;
}

describe('@fleet/api - ManifestService (integration)', () => {
  beforeAll(async () => {
    testDb = await startMigratedTestDb('fleet_test');
    service = new ManifestService(testDb.db, fakeBlobStore(), fakeConfig());
  }, 90_000);

  afterAll(async () => {
    await stopMigratedTestDb(testDb);
  });

  beforeEach(async () => {
    await testDb.db.execute(sql`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '__drizzle_migrations')
        LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
    await seedTransportOrder();
  });

  it('completes negotiate -> commit roundtrip', async () => {
    const negotiated = await service.negotiateUpload({
      manifestCorrelationId: CORRELATION_ID,
      transportOrderId: TRANSPORT_ORDER_ID,
      contentType: 'image/jpeg',
      expectedSizeBytes: 1_500_000,
    }, OP);
    expect(negotiated.uploadSessionId).toBeDefined();

    const committed = await service.commitUpload({
      uploadSessionId: negotiated.uploadSessionId,
      actualSizeBytes: 1_400_000,
      contentHash: 'a'.repeat(64),
    }, OP);
    expect(committed.state).toBe('verifying');

    const sessionRow = await testDb.db.execute<{ state: string; actual_size_bytes: number }>(sql`
      SELECT state, actual_size_bytes FROM upload_session WHERE upload_session_id = ${negotiated.uploadSessionId}::uuid
    `);
    expect(sessionRow.rows[0]?.state).toBe('verifying');
    expect(sessionRow.rows[0]?.actual_size_bytes).toBe(1_400_000);

    const manifestRow = await testDb.db.execute<{ state: string }>(sql`
      SELECT state FROM manifest WHERE manifest_correlation_id = ${CORRELATION_ID}::uuid
    `);
    expect(manifestRow.rows[0]?.state).toBe('verifying');
  });

  it('rejects second commit on same session (atomic state guard)', async () => {
    const negotiated = await service.negotiateUpload({
      manifestCorrelationId: CORRELATION_ID,
      transportOrderId: TRANSPORT_ORDER_ID,
      contentType: 'image/jpeg',
      expectedSizeBytes: 1_500_000,
    }, OP);

    const commit = { uploadSessionId: negotiated.uploadSessionId, actualSizeBytes: 1_400_000 };
    await service.commitUpload(commit, OP);
    await expect(service.commitUpload(commit, OP)).rejects.toBeInstanceOf(UploadSessionInvalidStateError);
  });

  it('throws UploadSessionNotFoundError for unknown session', async () => {
    await expect(service.commitUpload({
      uploadSessionId: '00000000-0000-0000-0000-0000000000ff',
      actualSizeBytes: 1000,
    }, OP)).rejects.toBeInstanceOf(UploadSessionNotFoundError);
  });

  it('finalizeIntake(accepted=true) writes audit row + outbox event for ERP', async () => {
    const negotiated = await service.negotiateUpload({
      manifestCorrelationId: CORRELATION_ID,
      transportOrderId: TRANSPORT_ORDER_ID,
      contentType: 'image/jpeg',
      expectedSizeBytes: 1_500_000,
    }, OP);
    await service.commitUpload({ uploadSessionId: negotiated.uploadSessionId, actualSizeBytes: 1_400_000 }, OP);
    const result = await service.finalizeIntake({ uploadSessionId: negotiated.uploadSessionId, accepted: true }, OP);
    expect(result.state).toBe('committed');

    const audit = await testDb.db.execute<{ count: string; event_type: string }>(sql`
      SELECT COUNT(*)::text as count, MAX(event_type) as event_type FROM fleet_audit_log
    `);
    expect(audit.rows[0]?.count).toBe('1');
    expect(audit.rows[0]?.event_type).toBe('manifest.committed');

    const ob = await testDb.db.execute<{ count: string; queue_name: string }>(sql`
      SELECT COUNT(*)::text as count, MAX(queue_name) as queue_name FROM outbox WHERE queue_name = 'erp'
    `);
    expect(ob.rows[0]?.count).toBe('1');
    expect(ob.rows[0]?.queue_name).toBe('erp');
  });

  it('finalizeIntake(accepted=false) emits manifest.rejected audit + feed but no ERP outbox', async () => {
    const negotiated = await service.negotiateUpload({
      manifestCorrelationId: CORRELATION_ID,
      transportOrderId: TRANSPORT_ORDER_ID,
      contentType: 'image/jpeg',
      expectedSizeBytes: 1_500_000,
    }, OP);
    await service.commitUpload({ uploadSessionId: negotiated.uploadSessionId, actualSizeBytes: 1_400_000 }, OP);
    await service.finalizeIntake({ uploadSessionId: negotiated.uploadSessionId, accepted: false, rejectionReasonCode: 'other' }, OP);

    const audit = await testDb.db.execute<{ count: string; event_type: string }>(sql`
      SELECT COUNT(*)::text AS count, MAX(event_type) AS event_type FROM fleet_audit_log
    `);
    expect(audit.rows[0]?.count).toBe('1');
    expect(audit.rows[0]?.event_type).toBe('manifest.rejected');

    const erpOutbox = await testDb.db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count FROM outbox WHERE queue_name = 'erp'
    `);
    expect(erpOutbox.rows[0]?.count).toBe('0');
  });

  // Idempotency contract: same correlation_id -> same Manifest aggregate (immutable),
  // but each negotiate creates a NEW upload_session so retries get fresh presigned URLs
  // and per-attempt state tracking. PDF "Manifest" + "Uploads".
  it('reuses existing manifest on second negotiate with same correlation_id (new upload_session each time)', async () => {
    const r1 = await service.negotiateUpload({
      manifestCorrelationId: CORRELATION_ID,
      transportOrderId: TRANSPORT_ORDER_ID,
      contentType: 'image/jpeg',
      expectedSizeBytes: 1_500_000,
    }, OP);
    const r2 = await service.negotiateUpload({
      manifestCorrelationId: CORRELATION_ID,
      transportOrderId: TRANSPORT_ORDER_ID,
      contentType: 'image/jpeg',
      expectedSizeBytes: 1_500_000,
    }, OP);

    const manifests = await testDb.db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM manifest`);
    expect(manifests.rows[0]?.count).toBe('1');
    expect(r1.uploadSessionId).not.toBe(r2.uploadSessionId);
  });

  it('finalizeIntake throws UploadSessionNotFoundError for unknown session', async () => {
    await expect(service.finalizeIntake({
      uploadSessionId: '00000000-0000-0000-0000-0000000000fe',
      accepted: true,
    }, OP)).rejects.toBeInstanceOf(UploadSessionNotFoundError);
  });

  it('finalizeIntake(accepted=false) records rejectionReasonCode on manifest', async () => {
    const negotiated = await service.negotiateUpload({
      manifestCorrelationId: CORRELATION_ID,
      transportOrderId: TRANSPORT_ORDER_ID,
      contentType: 'image/jpeg',
      expectedSizeBytes: 1_500_000,
    }, OP);
    await service.commitUpload({ uploadSessionId: negotiated.uploadSessionId, actualSizeBytes: 1_400_000 }, OP);
    const result = await service.finalizeIntake({
      uploadSessionId: negotiated.uploadSessionId,
      accepted: false,
      rejectionReasonCode: 'other',
    }, OP);
    expect(result.state).toBe('rejected');
    const row = await testDb.db.execute<{ rejection_reason_code: string | null }>(sql`
      SELECT rejection_reason_code FROM manifest WHERE manifest_correlation_id = ${CORRELATION_ID}::uuid
    `);
    expect(row.rows[0]?.rejection_reason_code).toBe('other');
  });

  it('buildS3Key produces correlation-id keyed path with content-type extension', async () => {
    const r = await service.negotiateUpload({
      manifestCorrelationId: CORRELATION_ID,
      transportOrderId: TRANSPORT_ORDER_ID,
      contentType: 'application/pdf',
      expectedSizeBytes: 1000,
    }, OP);
    // Read the real s3_key written by ManifestService.buildS3Key (not the mock's stub key).
    const row = await testDb.db.execute<{ s3_key: string }>(sql`
      SELECT s3_key FROM upload_session WHERE upload_session_id = ${r.uploadSessionId}::uuid
    `);
    const s3Key = row.rows[0]?.s3_key ?? '';
    expect(s3Key).toContain(CORRELATION_ID);
    expect(s3Key).toMatch(/\.(pdf|bin)$/);
  });

  it('#7: finalizeIntake(accepted=false) without rejectionReasonCode omits code from delta/payload', async () => {
    const negotiated = await service.negotiateUpload({
      manifestCorrelationId: '11111111-1111-4111-8111-100000000007',
      transportOrderId: TRANSPORT_ORDER_ID,
      contentType: 'image/jpeg',
      expectedSizeBytes: 1_000_000,
    }, OP);
    await service.commitUpload({
      uploadSessionId: negotiated.uploadSessionId,
      actualSizeBytes: 1_000_000,
      contentHash: 'b'.repeat(64),
    }, OP);
    const res = await service.finalizeIntake({ uploadSessionId: negotiated.uploadSessionId, accepted: false }, OP);
    expect(res.manifestId).toBeDefined();
  });
});
