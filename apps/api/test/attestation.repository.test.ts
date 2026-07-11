// apps/api/test/attestation.repository.test.ts
// Persists attestation columns on device_registry. PGlite integration.
// Schema comes from startPgliteTestDb (real drizzle migrations applied to
// PGlite), NEVER inline CREATE TABLE: the previous hardcoded DDL drifted the
// moment migration 0027 added the device-binding columns and every insert
// through the drizzle schema object started failing with 42703. Real
// migrations make drift structurally impossible.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { AttestationRepositoryImpl } from '../src/device/attestation.repository.js';
import { deviceRegistry } from '../src/database/schema/device.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';

describe('AttestationRepositoryImpl (pglite)', () => {
  let testDb: PgliteTestDb;
  let repo: AttestationRepositoryImpl;
  let deviceId: string;

  beforeEach(async () => {
    testDb = await startPgliteTestDb();
    repo = new AttestationRepositoryImpl(testDb.db as never);
    const r = await testDb.db.insert(deviceRegistry).values({
      companyId: '00000000-0000-0000-0000-000000000001',
      businessUnitId: '00000000-0000-0000-0000-000000000002',
      depotId: '00000000-0000-0000-0000-000000000003',
      legalEntityId: '00000000-0000-0000-0000-000000000004',
      operatorId: '00000000-0000-0000-0000-0000000000a1',
      platform: 'android',
      appVersion: '1.0.0',
    }).returning({ deviceId: deviceRegistry.deviceId });
    const inserted = r[0];
    if (inserted === undefined) throw new Error('insert returned no row');
    deviceId = inserted.deviceId;
  });

  afterEach(async () => {
    await stopPgliteTestDb(testDb);
  });

  it('writes attestation_platform, attestation_verified_at, attestation_token_hash', async () => {
    await repo.markAttestationVerified({ deviceId, platform: 'android', tokenHashHex: 'a'.repeat(64) });
    const rows = await testDb.db.select().from(deviceRegistry).where(eq(deviceRegistry.deviceId, deviceId));
    const row = rows[0];
    if (row === undefined) throw new Error('expected device row');
    expect(row.attestationPlatform).toBe('android');
    expect(row.attestationTokenHash).toBe('a'.repeat(64));
    expect(row.attestationVerifiedAt).toBeInstanceOf(Date);
  });

  it('updates timestamp on each call (re-attestation refreshes freshness window)', async () => {
    await repo.markAttestationVerified({ deviceId, platform: 'android', tokenHashHex: 'a'.repeat(64) });
    const firstRows = await testDb.db.select().from(deviceRegistry).where(eq(deviceRegistry.deviceId, deviceId));
    const firstRow = firstRows[0];
    if (firstRow === undefined) throw new Error('expected first device row');
    const first = firstRow.attestationVerifiedAt;
    await new Promise((r) => setTimeout(r, 10));
    await repo.markAttestationVerified({ deviceId, platform: 'android', tokenHashHex: 'b'.repeat(64) });
    const secondRows = await testDb.db.select().from(deviceRegistry).where(eq(deviceRegistry.deviceId, deviceId));
    const secondRow = secondRows[0];
    if (secondRow === undefined) throw new Error('expected second device row');
    const second = secondRow.attestationVerifiedAt;
    if (first === null || second === null) throw new Error('attestationVerifiedAt not set');
    expect(second.getTime()).toBeGreaterThan(first.getTime());
  });
});
