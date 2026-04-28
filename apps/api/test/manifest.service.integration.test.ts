// apps/api/test/manifest.service.integration.test.ts
// Full negotiate -> commit roundtrip against real Postgres.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '../src/database/schema/index.js';
import { ManifestService, type OperatorContext } from '../src/manifest/manifest.service.js';
import { UploadAlreadyCommittedError, UploadSessionNotFoundError } from '../src/manifest/manifest.errors.js';
import type { IBlobStore, PresignedUpload } from '../src/storage/storage-provider.interface.js';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../src/config/env.config.js';

const POSTGRES_IMAGE = 'postgres:16.4-alpine3.20';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let service: ManifestService;

const OP: OperatorContext = {
  operatorId: '00000000-0000-0000-0000-000000000002',
  companyId: '00000000-0000-0000-0000-000000000003',
  businessUnitId: '00000000-0000-0000-0000-000000000004',
  depotId: '00000000-0000-0000-0000-000000000005',
  legalEntityId: '00000000-0000-0000-0000-000000000006',
};

const TRANSPORT_ORDER_ID = '00000000-0000-0000-0000-0000000000b1';
const CORRELATION_ID = '00000000-0000-0000-0000-0000000000a1';

async function applySchema(d: NodePgDatabase<typeof schema>): Promise<void> {
  await d.execute(sql`CREATE TYPE transport_order_state AS ENUM ('draft','assigned','in_transit','completed','cancelled')`);
  await d.execute(sql`CREATE TYPE manifest_state AS ENUM ('pending','verifying','captured','committed','rejected')`);
  await d.execute(sql`CREATE TYPE upload_session_state AS ENUM ('initiated','uploading','verifying','committed','rejected','aborted')`);
  await d.execute(sql`CREATE TYPE manifest_rejection_reason AS ENUM ('blurred_image','wrong_manifest','missing_page','oversized_file','unsupported_format','duplicate_upload','hash_mismatch','virus_detected','other')`);
  await d.execute(sql`
    CREATE TABLE transport_order (
      transport_order_id UUID PRIMARY KEY,
      company_id UUID NOT NULL, business_unit_id UUID NOT NULL, depot_id UUID NOT NULL, legal_entity_id UUID NOT NULL,
      external_ref VARCHAR(64), state transport_order_state NOT NULL DEFAULT 'draft',
      customer_id UUID, metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await d.execute(sql`
    CREATE TABLE manifest (
      manifest_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL, business_unit_id UUID NOT NULL, depot_id UUID NOT NULL, legal_entity_id UUID NOT NULL,
      transport_order_id UUID NOT NULL REFERENCES transport_order(transport_order_id) ON DELETE CASCADE,
      manifest_correlation_id UUID NOT NULL UNIQUE,
      state manifest_state NOT NULL DEFAULT 'pending',
      captured_by_operator_id UUID,
      captured_at TIMESTAMPTZ,
      committed_at TIMESTAMPTZ,
      rejection_reason_code manifest_rejection_reason,
      rejection_reason_text VARCHAR(500),
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await d.execute(sql`
    CREATE TABLE upload_session (
      upload_session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL, business_unit_id UUID NOT NULL, depot_id UUID NOT NULL, legal_entity_id UUID NOT NULL,
      manifest_id UUID REFERENCES manifest(manifest_id) ON DELETE CASCADE,
      operator_id UUID NOT NULL,
      s3_key VARCHAR(512) NOT NULL,
      s3_bucket VARCHAR(128) NOT NULL,
      content_type VARCHAR(128) NOT NULL,
      expected_size_bytes INTEGER,
      actual_size_bytes INTEGER,
      state upload_session_state NOT NULL DEFAULT 'initiated',
      content_hash VARCHAR(128),
      initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      committed_at TIMESTAMPTZ,
      aborted_at TIMESTAMPTZ
    )
  `);
}

async function seedTransportOrder(d: NodePgDatabase<typeof schema>): Promise<void> {
  await d.execute(sql`
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
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase('fleet_test').withReuse().start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    db = drizzle(pool, { schema, casing: 'snake_case' });
    await applySchema(db);
    service = new ManifestService(db, fakeBlobStore(), fakeConfig());
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    await db.execute(sql`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema())
        LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
    await seedTransportOrder(db);
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

    const sessionRow = await db.execute<{ state: string; actual_size_bytes: number }>(sql`
      SELECT state, actual_size_bytes FROM upload_session WHERE upload_session_id = ${negotiated.uploadSessionId}::uuid
    `);
    expect(sessionRow.rows[0]?.state).toBe('verifying');
    expect(sessionRow.rows[0]?.actual_size_bytes).toBe(1_400_000);

    const manifestRow = await db.execute<{ state: string }>(sql`
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
    await expect(service.commitUpload(commit, OP)).rejects.toBeInstanceOf(UploadAlreadyCommittedError);
  });

  it('throws UploadSessionNotFoundError for unknown session', async () => {
    await expect(service.commitUpload({
      uploadSessionId: '00000000-0000-0000-0000-0000000000ff',
      actualSizeBytes: 1000,
    }, OP)).rejects.toBeInstanceOf(UploadSessionNotFoundError);
  });

  it('reuses existing manifest on second negotiate with same correlation_id', async () => {
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

    const manifests = await db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM manifest`);
    expect(manifests.rows[0]?.count).toBe('1');
    expect(r1.uploadSessionId).not.toBe(r2.uploadSessionId);
  });
});
