// apps/api/test/attestation.repository.test.ts
// RED: persists attestation columns on device_registry. PGlite integration.
import { describe, it, expect, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { AttestationRepositoryImpl } from '../src/device/attestation.repository.js';
import { deviceRegistry } from '../src/database/schema/device.js';
const DDL = [
  `CREATE TABLE device_registry (
    device_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    depot_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    operator_id uuid NOT NULL,
    platform varchar(32) NOT NULL,
    app_version varchar(32) NOT NULL,
    expo_push_token varchar(256),
    udid varchar(128),
    enrolled_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz,
    attestation_platform varchar(16),
    attestation_verified_at timestamptz,
    attestation_token_hash varchar(64)
  )`,
];
describe('AttestationRepositoryImpl (pglite)', () => {
  let db: ReturnType<typeof drizzle>;
  let repo: AttestationRepositoryImpl;
  let deviceId: string;
  beforeEach(async () => {
    const pg = new PGlite();
    for (const stmt of DDL) await pg.exec(stmt);
    db = drizzle(pg);
    repo = new AttestationRepositoryImpl(db as never);
    const r = await db.insert(deviceRegistry).values({
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
  it('writes attestation_platform, attestation_verified_at, attestation_token_hash', async () => {
    await repo.markAttestationVerified({ deviceId, platform: 'android', tokenHashHex: 'a'.repeat(64) });
    const rows = await db.select().from(deviceRegistry).where(eq(deviceRegistry.deviceId, deviceId));
    const row = rows[0];
    if (row === undefined) throw new Error('expected device row');
    expect(row.attestationPlatform).toBe('android');
    expect(row.attestationTokenHash).toBe('a'.repeat(64));
    expect(row.attestationVerifiedAt).toBeInstanceOf(Date);
  });
  it('updates timestamp on each call (re-attestation refreshes freshness window)', async () => {
    await repo.markAttestationVerified({ deviceId, platform: 'android', tokenHashHex: 'a'.repeat(64) });
    const firstRows = await db.select().from(deviceRegistry).where(eq(deviceRegistry.deviceId, deviceId));
    const firstRow = firstRows[0];
    if (firstRow === undefined) throw new Error('expected first device row');
    const first = firstRow.attestationVerifiedAt;
    await new Promise((r) => setTimeout(r, 10));
    await repo.markAttestationVerified({ deviceId, platform: 'android', tokenHashHex: 'b'.repeat(64) });
    const secondRows = await db.select().from(deviceRegistry).where(eq(deviceRegistry.deviceId, deviceId));
    const secondRow = secondRows[0];
    if (secondRow === undefined) throw new Error('expected second device row');
    const second = secondRow.attestationVerifiedAt;
    if (first === null || second === null) throw new Error('attestationVerifiedAt not set');
    expect(second.getTime()).toBeGreaterThan(first.getTime());
  });
});
