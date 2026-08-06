// apps/api/test/manifest.negotiate-delivery-gate.integration.test.ts
// outside-in strict TDD: the AUTHORITATIVE server enforcement of the delivery-
// capture phase-gate invariant. A driver may not negotiate a manifest upload for
// the DELIVERY stop (kho giao hang) until EVERY pickup stop (kho nhan hang) has a
// committed proof photo. Pickups are order-independent among themselves. The
// client Alert (card-capture-gate) is UX only and bypassable; THIS is the real
// enforcement, using the same @fleet/domain evaluateDeliveryGate rule server-side
// (one rule, two surfaces). Gating at negotiate blocks the upload at the earliest
// authoritative point, before any presigned URL is issued.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ManifestService } from '../src/manifest/manifest.service.js';
import { DeliveryCaptureGateError } from '../src/manifest/manifest.errors.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import type { IBlobStore, PresignedUpload } from '../src/storage/storage-provider.interface.js';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../src/config/env.config.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb, truncateAllTables } from './helpers/migrate-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: MigratedTestDb;
let service: ManifestService;
const OP: OperatorContext = createOperatorContext();

const TO_ID = '00000000-0000-0000-0000-0000000000d1';
const PICKUP_A = '00000000-0000-0000-0000-0000000000e1';
const PICKUP_B = '00000000-0000-0000-0000-0000000000e2';
const DELIVERY = '00000000-0000-0000-0000-0000000000e3';

// Two pickups + one delivery, so the order-independent-pickups rule is exercised.
async function seedTwoPickupsOneDelivery(): Promise<void> {
  await testDb.db.execute(sql`
    INSERT INTO transport_order (transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, state)
    VALUES (${TO_ID}::uuid, ${OP.companyId}::uuid, ${OP.businessUnitId}::uuid, ${OP.depotId}::uuid, ${OP.legalEntityId}::uuid, 'assigned')
    ON CONFLICT DO NOTHING
  `);
  await testDb.db.execute(sql`
    INSERT INTO stop (stop_id, company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, sequence, stop_type)
    VALUES
      (${PICKUP_A}::uuid, ${OP.companyId}::uuid, ${OP.businessUnitId}::uuid, ${OP.depotId}::uuid, ${OP.legalEntityId}::uuid, ${TO_ID}::uuid, 1, 'pickup'),
      (${PICKUP_B}::uuid, ${OP.companyId}::uuid, ${OP.businessUnitId}::uuid, ${OP.depotId}::uuid, ${OP.legalEntityId}::uuid, ${TO_ID}::uuid, 2, 'pickup'),
      (${DELIVERY}::uuid, ${OP.companyId}::uuid, ${OP.businessUnitId}::uuid, ${OP.depotId}::uuid, ${OP.legalEntityId}::uuid, ${TO_ID}::uuid, 3, 'delivery')
    ON CONFLICT DO NOTHING
  `);
}

// Insert a committed manifest already attached to a given stop (a proof photo).
async function commitProofFor(stopId: string): Promise<void> {
  await testDb.db.execute(sql`
    INSERT INTO manifest (manifest_id, company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, manifest_correlation_id, stop_id, state)
    VALUES (${randomUUID()}::uuid, ${OP.companyId}::uuid, ${OP.businessUnitId}::uuid, ${OP.depotId}::uuid, ${OP.legalEntityId}::uuid, ${TO_ID}::uuid, ${randomUUID()}::uuid, ${stopId}::uuid, 'committed')
  `);
}

function fakeBlobStore(): IBlobStore {
  return {
    presignUpload: vi.fn().mockResolvedValue({
      url: 'https://s3.example/presigned', key: 'manifests/co/m1/a1.jpg', bucket: 'fleet-test',
      expiresAt: new Date('2026-06-10T20:00:00Z'),
    } satisfies PresignedUpload),
  };
}
function fakeConfig(): ConfigService<Env, true> {
  return { getOrThrow: vi.fn().mockReturnValue(900) } as unknown as ConfigService<Env, true>;
}

function negotiateDelivery(): Promise<unknown> {
  return service.negotiateUpload({
    manifestCorrelationId: randomUUID(),
    transportOrderId: TO_ID,
    contentType: 'image/jpeg',
    expectedSizeBytes: 1000,
    stop: { stopId: DELIVERY, stopSequence: null },
  }, OP);
}

describe('@fleet/api - negotiateUpload delivery-capture gate (authoritative server enforcement)', () => {
  beforeAll(async () => {
    testDb = await startMigratedTestDb('fleet_test');
    service = new ManifestService(testDb.db, fakeBlobStore(), fakeConfig());
  });
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    await truncateAllTables(testDb.db);
    await seedTwoPickupsOneDelivery();
  });

  it('BLOCKS delivery negotiate when NO pickup has a committed photo', async () => {
    await expect(negotiateDelivery()).rejects.toBeInstanceOf(DeliveryCaptureGateError);
  });
  it('BLOCKS delivery negotiate when only SOME pickups have a committed photo', async () => {
    await commitProofFor(PICKUP_A);
    await expect(negotiateDelivery()).rejects.toBeInstanceOf(DeliveryCaptureGateError);
  });
  it('ALLOWS delivery negotiate once EVERY pickup has a committed photo (any order)', async () => {
    await commitProofFor(PICKUP_B);
    await commitProofFor(PICKUP_A);
    const negotiated = await negotiateDelivery();
    expect(negotiated).toHaveProperty('uploadSessionId');
  });
  it('NEVER blocks a pickup negotiate (pickups are order-independent)', async () => {
    const negotiated = await service.negotiateUpload({
      manifestCorrelationId: randomUUID(),
      transportOrderId: TO_ID,
      contentType: 'image/jpeg',
      expectedSizeBytes: 1000,
      stop: { stopId: PICKUP_B, stopSequence: null },
    }, OP);
    expect(negotiated).toHaveProperty('uploadSessionId');
  });
});
