// apps/api/test/manifest.negotiate-stop-association.integration.test.ts
// outside-in strict TDD RED: /upload/negotiate accepts an optional stop ref
// (ManifestStopRefSchema from @fleet/sync-protocol — Zod-first single source
// of truth) and persists the resolved stop PK onto manifest.stop_id so the
// dispatch board can render the per-stop Phiếu Cân proof link. Capture-time
// tagging is the only reliable association (contract line 9-10).
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

const TRANSPORT_ORDER_ID = '00000000-0000-0000-0000-0000000000b1';
const STOP_ID_SEQ1 = '00000000-0000-0000-0000-0000000000c1';
const STOP_ID_SEQ2 = '00000000-0000-0000-0000-0000000000c2';

async function seedTransportOrderWithStops(): Promise<void> {
  await testDb.db.execute(sql`
    INSERT INTO transport_order (transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, state)
    VALUES (${TRANSPORT_ORDER_ID}::uuid, ${OP.companyId}::uuid, ${OP.businessUnitId}::uuid, ${OP.depotId}::uuid, ${OP.legalEntityId}::uuid, 'assigned')
    ON CONFLICT DO NOTHING
  `);
  await testDb.db.execute(sql`
    INSERT INTO stop (stop_id, company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, sequence, stop_type)
    VALUES
      (${STOP_ID_SEQ1}::uuid, ${OP.companyId}::uuid, ${OP.businessUnitId}::uuid, ${OP.depotId}::uuid, ${OP.legalEntityId}::uuid, ${TRANSPORT_ORDER_ID}::uuid, 1, 'pickup'),
      (${STOP_ID_SEQ2}::uuid, ${OP.companyId}::uuid, ${OP.businessUnitId}::uuid, ${OP.depotId}::uuid, ${OP.legalEntityId}::uuid, ${TRANSPORT_ORDER_ID}::uuid, 2, 'delivery')
    ON CONFLICT DO NOTHING
  `);
}

function fakeBlobStore(): IBlobStore {
  return {
    presignUpload: vi.fn().mockResolvedValue({
      url: 'https://s3.example/presigned',
      key: 'manifests/co/m1/a1.jpg',
      bucket: 'fleet-test',
      expiresAt: new Date('2026-06-10T20:00:00Z'),
    } satisfies PresignedUpload),
  };
}

function fakeConfig(): ConfigService<Env, true> {
  return { getOrThrow: vi.fn().mockReturnValue(900) } as unknown as ConfigService<Env, true>;
}

async function manifestStopIdFor(uploadSessionId: string): Promise<string | null> {
  const res = await testDb.db.execute(sql`
    SELECT m.stop_id FROM manifest m
    JOIN upload_session us ON us.manifest_id = m.manifest_id
    WHERE us.upload_session_id = ${uploadSessionId}::uuid
  `);
  const rows = res.rows as unknown as readonly { stop_id: string | null }[];
  expect(rows.length).toBe(1);
  const row = rows[0];
  if (row === undefined) throw new Error('row missing after length assertion');
  return row.stop_id;
}

describe('@fleet/api - negotiateUpload persists manifest.stop_id from stop ref', () => {
  beforeAll(async () => {
    testDb = await startMigratedTestDb('fleet_test');
    service = new ManifestService(testDb.db, fakeBlobStore(), fakeConfig());
  });

  afterAll(async () => {
    await stopMigratedTestDb(testDb);
  });

  beforeEach(async () => {
    await truncateAllTables(testDb.db);
    await seedTransportOrderWithStops();
  });

  it('resolves stop: {stopSequence: 2} to the stop PK and persists manifest.stop_id', async () => {
    const negotiated = await service.negotiateUpload({
      manifestCorrelationId: randomUUID(),
      transportOrderId: TRANSPORT_ORDER_ID,
      contentType: 'image/jpeg',
      expectedSizeBytes: 1000,
      stop: { stopId: null, stopSequence: 2 },
    }, OP);
    expect(await manifestStopIdFor(negotiated.uploadSessionId)).toBe(STOP_ID_SEQ2);
  });

  it('persists manifest.stop_id directly when stop: {stopId} is supplied', async () => {
    const negotiated = await service.negotiateUpload({
      manifestCorrelationId: randomUUID(),
      transportOrderId: TRANSPORT_ORDER_ID,
      contentType: 'image/jpeg',
      expectedSizeBytes: 1000,
      stop: { stopId: STOP_ID_SEQ1, stopSequence: null },
    }, OP);
    expect(await manifestStopIdFor(negotiated.uploadSessionId)).toBe(STOP_ID_SEQ1);
  });

  it('leaves manifest.stop_id null when no stop ref is supplied (EXPAND-only back-compat)', async () => {
    const negotiated = await service.negotiateUpload({
      manifestCorrelationId: randomUUID(),
      transportOrderId: TRANSPORT_ORDER_ID,
      contentType: 'image/jpeg',
      expectedSizeBytes: 1000,
    }, OP);
    expect(await manifestStopIdFor(negotiated.uploadSessionId)).toBe(null);
  });

  it('rejects a stopSequence that does not exist on the transport order', async () => {
    await expect(service.negotiateUpload({
      manifestCorrelationId: randomUUID(),
      transportOrderId: TRANSPORT_ORDER_ID,
      contentType: 'image/jpeg',
      expectedSizeBytes: 1000,
      stop: { stopId: null, stopSequence: 99 },
    }, OP)).rejects.toThrow();
  });

  it('rejects a stopId belonging to a different transport order (cross-order guard)', async () => {
    const otherOrderId = randomUUID();
    const foreignStopId = randomUUID();
    await testDb.db.execute(sql`
      INSERT INTO transport_order (transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, state)
      VALUES (${otherOrderId}::uuid, ${OP.companyId}::uuid, ${OP.businessUnitId}::uuid, ${OP.depotId}::uuid, ${OP.legalEntityId}::uuid, 'assigned')
    `);
    await testDb.db.execute(sql`
      INSERT INTO stop (stop_id, company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, sequence, stop_type)
      VALUES (${foreignStopId}::uuid, ${OP.companyId}::uuid, ${OP.businessUnitId}::uuid, ${OP.depotId}::uuid, ${OP.legalEntityId}::uuid, ${otherOrderId}::uuid, 1, 'pickup')
    `);
    await expect(service.negotiateUpload({
      manifestCorrelationId: randomUUID(),
      transportOrderId: TRANSPORT_ORDER_ID,
      contentType: 'image/jpeg',
      expectedSizeBytes: 1000,
      stop: { stopId: foreignStopId, stopSequence: null },
    }, OP)).rejects.toThrow();
  });
});
