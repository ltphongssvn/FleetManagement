// apps/api/test/manifest.commit-enqueues-intake.integration.test.ts
// CONTRACT test (RED-first) for the producer<->consumer intake wire shape.
// The earlier version only asserted COUNT(intake outbox rows)==1, which gave
// false confidence: it passed while the payload was schema-invalid, and the bug
// (worker dead_letter:schema_validation_failed) only surfaced in prod.
//
// The outbox relay routes on the envelope ({aggregateType,eventType}) then
// enqueues the BODY (payload minus those two fields) as the BullMQ job. The
// worker strict-parses that body with IntakeJobDataWireSchema (@fleet/sync-protocol).
// So: after commitUpload, the intake outbox row's payload, with the routing
// envelope stripped, MUST parse against IntakeJobDataWireSchema. This contract
// test catches drift at the producer boundary instead of in prod.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { IntakeJobDataWireSchema } from '@fleet/sync-protocol';
import { ManifestService } from '../src/manifest/manifest.service.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import type { IBlobStore, PresignedUpload } from '../src/storage/storage-provider.interface.js';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../src/config/env.config.js';
import {
  startMigratedTestDb,
  stopMigratedTestDb,
  type MigratedTestDb,
  truncateAllTables,
} from './helpers/migrate-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: MigratedTestDb;
let service: ManifestService;
const OP: OperatorContext = createOperatorContext();

function fakeBlobStore(): IBlobStore {
  return {
    presignUpload: vi.fn().mockImplementation(() =>
      Promise.resolve({
        url: 'https://s3.example/presigned',
        key: 'manifests/co/' + randomUUID() + '/x.jpg',
        bucket: 'fleet-test',
        expiresAt: new Date('2026-04-27T20:00:00Z'),
      } satisfies PresignedUpload),
    ),
  };
}
function fakeConfig(): ConfigService<Env, true> {
  return { getOrThrow: vi.fn().mockReturnValue(900) } as unknown as ConfigService<Env, true>;
}

async function negotiateThenCommit(): Promise<void> {
  const transportOrderId = randomUUID();
  const correlationId = randomUUID();
  await testDb.db.execute(sql`
    INSERT INTO transport_order (transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, state)
    VALUES (${transportOrderId}::uuid, ${OP.companyId}::uuid, ${OP.businessUnitId}::uuid, ${OP.depotId}::uuid, ${OP.legalEntityId}::uuid, 'assigned')
  `);
  const negotiated = await service.negotiateUpload(
    {
      manifestCorrelationId: correlationId,
      transportOrderId,
      contentType: 'image/jpeg',
      expectedSizeBytes: 1000,
    },
    OP,
  );
  await service.commitUpload(
    { uploadSessionId: negotiated.uploadSessionId, actualSizeBytes: 900 },
    OP,
  );
}

describe('@fleet/api - commitUpload enqueues a schema-valid intake job', () => {
  beforeAll(async () => {
    testDb = await startMigratedTestDb('fleet_test_intake_contract');
  });
  afterAll(async () => {
    await stopMigratedTestDb(testDb);
  });
  beforeEach(async () => {
    service = new ManifestService(testDb.db, fakeBlobStore(), fakeConfig());
    await truncateAllTables(testDb.db);
  });

  it('writes exactly one intake outbox row', async () => {
    await negotiateThenCommit();
    const rows = await testDb.db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count FROM outbox WHERE queue_name = 'intake'
    `);
    expect(rows.rows[0]?.count).toBe('1');
  });

  it('intake outbox payload (envelope stripped) parses against IntakeJobDataWireSchema', async () => {
    await negotiateThenCommit();
    const rows = await testDb.db.execute<{ payload: unknown }>(sql`
      SELECT payload FROM outbox WHERE queue_name = 'intake' LIMIT 1
    `);
    const payload = rows.rows[0]?.payload as Record<string, unknown> | undefined;
    expect(payload).toBeDefined();
    if (!payload) throw new Error('no intake outbox row');
    // Strip the routing envelope the relay reads + removes before enqueue.
    const { aggregateType: _a, eventType: _e, serverSeq: _s, ...body } = payload;
    const result = IntakeJobDataWireSchema.safeParse(body);
    if (!result.success) {
      throw new Error('intake body failed schema: ' + JSON.stringify(result.error.issues));
    }
    expect(result.success).toBe(true);
  }, 60_000);
});
