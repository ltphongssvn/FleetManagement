// apps/api/test/manifest.extraction-status-and-manual.integration.test.ts
// Outside-in RED (closes gaps 1+2):
//  (2) finalizeExtraction must persist extraction_status on EVERY outcome so the
//      board can tell "processing" (pending) from "needs entry" (not_found/
//      unreadable) from a value. Today not_found writes nothing -> column stays
//      'pending', indistinguishable from never-processed. This test asserts the
//      new behaviour and so FAILS against current code.
//  (1) setManualNetWeight is a NEW method letting a dispatcher set kg by hand;
//      it must persist kg AND extraction_status='manual'. It does not exist yet
//      -> this file fails to compile (RED for the right reason).
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
import { ManifestStateInvalidTransitionError } from '../src/manifest/manifest.errors.js';

let testDb: MigratedTestDb;
let service: ManifestService;
const OP: OperatorContext = createOperatorContext();

function fakeBlobStore(): IBlobStore {
  return { presignUpload: vi.fn().mockImplementation(() => Promise.resolve({
    url: 'https://s3.example/presigned',
    key: `manifests/co/${randomUUID()}/x.jpg`,
    bucket: 'fleet-test',
    expiresAt: new Date('2026-06-15T20:00:00Z'),
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

async function verifyingManifest(): Promise<string> {
  const transportOrderId = randomUUID();
  await testDb.db.execute(sql`
    INSERT INTO transport_order (transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, state)
    VALUES (${transportOrderId}::uuid, ${OP.companyId}::uuid, ${OP.businessUnitId}::uuid, ${OP.depotId}::uuid, ${OP.legalEntityId}::uuid, 'assigned')
  `);
  const negotiated = await service.negotiateUpload({
    manifestCorrelationId: randomUUID(), transportOrderId,
    contentType: 'image/jpeg', expectedSizeBytes: 1000,
  }, OP);
  // commitUpload moves the manifest to 'verifying'; we deliberately do NOT
  // finalizeIntake, so it never reaches 'committed'.
  const c = await service.commitUpload({ uploadSessionId: negotiated.uploadSessionId, actualSizeBytes: 900 }, OP);
  return c.manifestId;
}

async function statusOf(manifestId: string): Promise<string> {
  const r = await testDb.db.execute(sql`SELECT extraction_status FROM manifest WHERE manifest_id = ${manifestId}::uuid`);
  return (r.rows[0] as { extraction_status: string }).extraction_status;
}
async function kgOf(manifestId: string): Promise<string | null> {
  const r = await testDb.db.execute(sql`SELECT extracted_net_weight_kg FROM manifest WHERE manifest_id = ${manifestId}::uuid`);
  return (r.rows[0] as { extracted_net_weight_kg: string | null }).extracted_net_weight_kg;
}

describe('@fleet/api - manifest extraction_status persistence + manual edit', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_extstatus'); });
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    service = new ManifestService(testDb.db, fakeBlobStore(), fakeConfig());
    await truncateAllTables(testDb.db);
  });

  it('new committed manifest starts extraction_status=pending', async () => {
    const manifestId = await committedManifest();
    expect(await statusOf(manifestId)).toBe('pending');
  });

  it('finalizeExtraction(extracted) sets status=extracted + kg', async () => {
    const manifestId = await committedManifest();
    await service.finalizeExtraction({ manifestId, status: 'extracted', extractedNetWeightKg: 20730 }, OP);
    expect(await statusOf(manifestId)).toBe('extracted');
    expect(Number(await kgOf(manifestId))).toBe(20730);
  });

  it('finalizeExtraction(not_found) persists status=not_found (kg stays null)', async () => {
    const manifestId = await committedManifest();
    await service.finalizeExtraction({ manifestId, status: 'not_found', extractedNetWeightKg: null }, OP);
    expect(await statusOf(manifestId)).toBe('not_found');
    expect(await kgOf(manifestId)).toBeNull();
  });

  it('finalizeExtraction(unreadable) persists status=unreadable (kg stays null)', async () => {
    const manifestId = await committedManifest();
    await service.finalizeExtraction({ manifestId, status: 'unreadable', extractedNetWeightKg: null }, OP);
    expect(await statusOf(manifestId)).toBe('unreadable');
    expect(await kgOf(manifestId)).toBeNull();
  });

  it('setManualNetWeight sets kg AND status=manual', async () => {
    const manifestId = await committedManifest();
    const r = await service.setManualNetWeight({ manifestId, extractedNetWeightKg: 42130 }, OP);
    expect(r).toMatchObject({ manifestId, status: 'manual' });
    expect(Number(await kgOf(manifestId))).toBe(42130);
    expect(await statusOf(manifestId)).toBe('manual');
  });

  it('setManualNetWeight rejects a manifest that is not committed (verifying)', async () => {
    const manifestId = await verifyingManifest();
    await expect(
      service.setManualNetWeight({ manifestId, extractedNetWeightKg: 42130 }, OP),
    ).rejects.toBeInstanceOf(ManifestStateInvalidTransitionError);
  });

  it('setManualNetWeight can correct a prior not_found to manual+value', async () => {
    const manifestId = await committedManifest();
    await service.finalizeExtraction({ manifestId, status: 'not_found', extractedNetWeightKg: null }, OP);
    await service.setManualNetWeight({ manifestId, extractedNetWeightKg: 42130 }, OP);
    expect(await statusOf(manifestId)).toBe('manual');
    expect(Number(await kgOf(manifestId))).toBe(42130);
  });
});
