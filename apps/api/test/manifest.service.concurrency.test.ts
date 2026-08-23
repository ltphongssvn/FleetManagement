// apps/api/test/manifest.service.concurrency.test.ts
// RED test: proves SELECT MAX(server_seq)+1 in ManifestService.finalizeIntake
// races under concurrent intake, producing duplicate server_seq values.
// Will go GREEN after migrating finalizeIntake to nextval('fleet_server_seq').
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
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
const PARALLELISM = 5;

function fakeBlobStore(): IBlobStore {
  return {
    presignUpload: vi.fn().mockImplementation(() =>
      Promise.resolve({
        url: 'https://s3.example/presigned',
        key: `manifests/co/${randomUUID()}/x.jpg`,
        bucket: 'fleet-test',
        expiresAt: new Date('2026-04-27T20:00:00Z'),
      } satisfies PresignedUpload),
    ),
  };
}
function fakeConfig(): ConfigService<Env, true> {
  return { getOrThrow: vi.fn().mockReturnValue(900) } as unknown as ConfigService<Env, true>;
}

describe('@fleet/api - ManifestService concurrent finalizeIntake (RED)', () => {
  beforeAll(async () => {
    testDb = await startMigratedTestDb('fleet_test');
    service = new ManifestService(testDb.db, fakeBlobStore(), fakeConfig());
  });

  afterAll(async () => {
    await stopMigratedTestDb(testDb);
  });

  beforeEach(async () => {
    await truncateAllTables(testDb.db);
  });

  it('allocates distinct server_seq for N concurrent finalizeIntake calls', async () => {
    const sessionIds: string[] = [];
    for (let i = 0; i < PARALLELISM; i++) {
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
          expectedSizeBytes: 1_000_000,
        },
        OP,
      );
      await service.commitUpload(
        {
          uploadSessionId: negotiated.uploadSessionId,
          actualSizeBytes: 900_000,
        },
        OP,
      );
      sessionIds.push(negotiated.uploadSessionId);
    }

    // Concurrent finalize — this is where the race happens.
    await Promise.all(
      sessionIds.map((id) => service.finalizeIntake({ uploadSessionId: id, accepted: true }, OP)),
    );

    const result = await testDb.db.execute<{ total: string; distinct: string }>(sql`
      SELECT COUNT(*)::text AS total, COUNT(DISTINCT server_seq)::text AS distinct
      FROM sync_change_feed
    `);
    expect(result.rows[0]?.total).toBe(String(PARALLELISM));
    // RED expectation: this is what should hold but currently fails under MAX+1.
    expect(result.rows[0]?.distinct).toBe(String(PARALLELISM));
  });
});
