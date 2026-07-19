// apps/api/test/manifest.finalize-emits-extraction.integration.test.ts
// RED (phieu-can net-weight extraction, API layer):
// 1) manifest table carries EXPAND-only nullable extracted_net_weight_kg.
// 2) finalizeIntake(accepted=true) ALSO emits manifest_extraction.requested to
//    outbox (routing: -> extraction queue) with an ExtractionJobDataWire body
//    so the worker can run the VLM pass. Rejected manifests must NOT emit it.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ExtractionJobDataWireSchema } from '@fleet/sync-protocol';
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
    key: `manifests/co/${randomUUID()}/x.jpg`,
    bucket: 'fleet-test',
    expiresAt: new Date('2026-06-12T20:00:00Z'),
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

describe('@fleet/api - finalizeIntake emits manifest_extraction.requested', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_ext'); });
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    service = new ManifestService(testDb.db, fakeBlobStore(), fakeConfig());
    await truncateAllTables(testDb.db);
  });

  it('schema: manifest.extracted_net_weight_kg exists, nullable numeric', async () => {
    const r = await testDb.db.execute(sql`
      SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'manifest' AND column_name = 'extracted_net_weight_kg'
    `);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ data_type: 'numeric', is_nullable: 'YES' });
  });

  it('accepted manifest emits extraction request with valid wire body', async () => {
    const sessionId = await setupVerifyingSession(randomUUID(), randomUUID());
    await service.finalizeIntake({ uploadSessionId: sessionId, accepted: true }, OP);
    const r = await testDb.db.execute(sql`
      SELECT payload FROM outbox WHERE payload->>'eventType' = 'manifest_extraction.requested'
    `);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    if (!row) throw new Error('outbox row missing after length assertion');
    const payload = row['payload'] as Record<string, unknown>;
    expect(payload['aggregateType']).toBe('manifest_extraction');
    // Relay strips the routing envelope (+serverSeq) before enqueueing; mirror that.
    const { aggregateType: _a, eventType: _e, serverSeq: _q, ...body } = payload;
    void _a; void _e; void _q;
    expect(ExtractionJobDataWireSchema.safeParse(body).success).toBe(true);
  });

  it('rejected manifest does NOT emit extraction request', async () => {
    const sessionId = await setupVerifyingSession(randomUUID(), randomUUID());
    await service.finalizeIntake({ uploadSessionId: sessionId, accepted: false, rejectionReasonCode: 'blurred_image' }, OP);
    const r = await testDb.db.execute(sql`
      SELECT 1 FROM outbox WHERE payload->>'eventType' = 'manifest_extraction.requested'
    `);
    expect(r.rows).toHaveLength(0);
  });
});
