// apps/api/test/manifest.finalize-extraction-result.integration.test.ts
// RED (phieu-can, API consume side): ManifestService.finalizeExtraction
// persists extracted_net_weight_kg on status='extracted' and emits
// manifest.net_weight_extracted (-> projections); not_found leaves kg null
// and emits nothing.
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
    key: `manifests/co/${randomUUID()}/x.jpg`,
    bucket: 'fleet-test',
    expiresAt: new Date('2026-06-12T20:00:00Z'),
  } satisfies PresignedUpload))};
}
function fakeConfig(): ConfigService<Env, true> {
  return { getOrThrow: vi.fn().mockReturnValue(900) } as unknown as ConfigService<Env, true>;
}

async function committedManifest(): Promise<string> {
  const transportOrderId = randomUUID();
  await testDb.db.execute(sql`
    INSERT INTO transport_order (transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, state)
    VALUES (${transportOrderId}::uuid, ${OP.companyId}::uuid, ${OP.businessUnitId}::uuid, ${OP.depotId}::uuid, ${OP.legalEntityId}::uuid, 'assigned')
  `);
  const negotiated = await service.negotiateUpload({
    manifestCorrelationId: randomUUID(), transportOrderId,
    contentType: 'image/jpeg', expectedSizeBytes: 1000,
  }, OP);
  await service.commitUpload({ uploadSessionId: negotiated.uploadSessionId, actualSizeBytes: 900 }, OP);
  const fin = await service.finalizeIntake({ uploadSessionId: negotiated.uploadSessionId, accepted: true }, OP);
  return fin.manifestId;
}

describe('@fleet/api - finalizeExtraction persists kg + emits projection event', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_extres'); }, 90_000);
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    service = new ManifestService(testDb.db, fakeBlobStore(), fakeConfig());
    await truncateAllTables(testDb.db);
  });

  it('extracted: writes kg and emits manifest.net_weight_extracted to projections', async () => {
    const manifestId = await committedManifest();
    const r = await service.finalizeExtraction({ manifestId, status: 'extracted', extractedNetWeightKg: 20730 }, OP);
    expect(r).toMatchObject({ manifestId, status: 'extracted' });
    const row = await testDb.db.execute(sql`SELECT extracted_net_weight_kg FROM manifest WHERE manifest_id = ${manifestId}::uuid`);
    expect(row.rows[0]).toMatchObject({ extracted_net_weight_kg: '20730.000' });
    const ob = await testDb.db.execute(sql`
      SELECT queue_name, payload FROM outbox WHERE payload->>'eventType' = 'manifest.net_weight_extracted'
    `);
    expect(ob.rows).toHaveLength(1);
    expect(ob.rows[0]).toMatchObject({ queue_name: 'projections' });
    const obRow = ob.rows[0];
    if (!obRow) throw new Error('outbox row missing after length assertion');
    const payload = obRow['payload'] as Record<string, unknown>;
    expect(payload['manifestId']).toBe(manifestId);
    expect(payload['extractedNetWeightKg']).toBe(20730);
  });

  it('not_found: kg stays null, no projection event', async () => {
    const manifestId = await committedManifest();
    await service.finalizeExtraction({ manifestId, status: 'not_found', extractedNetWeightKg: null }, OP);
    const row = await testDb.db.execute(sql`SELECT extracted_net_weight_kg FROM manifest WHERE manifest_id = ${manifestId}::uuid`);
    expect(row.rows[0]).toMatchObject({ extracted_net_weight_kg: null });
    const ob = await testDb.db.execute(sql`
      SELECT 1 FROM outbox WHERE payload->>'eventType' = 'manifest.net_weight_extracted'
    `);
    expect(ob.rows).toHaveLength(0);
  });
});
