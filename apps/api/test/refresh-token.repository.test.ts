// apps/api/test/refresh-token.repository.test.ts
// RED (driver-app-security arc, Phase 3.5a): drizzle adapter for the
// RefreshTokenRepositoryPort against real SQL (PGlite, house pattern from
// attestation.repository.test.ts). The heart is the ATOMIC single-use claim:
// one conditional UPDATE (revoked_at IS NULL AND expires_at > now) RETURNING
// the claimed row -- proven here by the second sequential claim returning
// null. driverActive is joined from driver.active so rotation can fail
// closed for disabled drivers.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { and, eq, isNull } from 'drizzle-orm';
import { RefreshTokenRepositoryImpl } from '../src/auth/refresh-token.repository.js';
import type { RefreshTokenRecord } from '../src/auth/refresh-token.service.js';
import { driverRefreshToken } from '../src/database/schema/driver-refresh-token.js';
import { driver } from '../src/database/schema/reference.js';

const DDL = [
  'CREATE TABLE driver (' +
    'driver_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),' +
    'company_id uuid NOT NULL,' +
    'business_unit_id uuid NOT NULL,' +
    'depot_id uuid NOT NULL,' +
    'legal_entity_id uuid NOT NULL,' +
    'full_name varchar(200) NOT NULL,' +
    'phone varchar(32),' +
    'password_hash varchar(128),' +
    'operator_id uuid,' +
    'active boolean NOT NULL DEFAULT true,' +
    'created_at timestamptz NOT NULL DEFAULT now()' +
  ')',
  'CREATE TABLE driver_refresh_token (' +
    'driver_refresh_token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),' +
    'company_id uuid NOT NULL,' +
    'business_unit_id uuid NOT NULL,' +
    'depot_id uuid NOT NULL,' +
    'legal_entity_id uuid NOT NULL,' +
    'driver_id uuid NOT NULL REFERENCES driver(driver_id),' +
    'operator_id uuid NOT NULL,' +
    'family_id uuid NOT NULL,' +
    'token_hash varchar(64) NOT NULL,' +
    'issued_at timestamptz NOT NULL DEFAULT now(),' +
    'expires_at timestamptz NOT NULL,' +
    'revoked_at timestamptz,' +
    'revoked_reason varchar(64),' +
    'replaced_by_token_hash varchar(64)' +
  ')',
  'CREATE UNIQUE INDEX driver_refresh_token_hash_uq ON driver_refresh_token (token_hash)',
];

const TENANCY = {
  companyId: '00000000-0000-0000-0000-000000000001',
  businessUnitId: '00000000-0000-0000-0000-000000000002',
  depotId: '00000000-0000-0000-0000-000000000003',
  legalEntityId: '00000000-0000-0000-0000-000000000004',
};
const OPERATOR_ID = '00000000-0000-0000-0000-0000000000a1';
const FAMILY_A = '00000000-0000-0000-0000-0000000000f1';

function record(driverId: string, tokenHash: string, expiresAt: Date): RefreshTokenRecord {
  return {
    driverId,
    ...TENANCY,
    operatorId: OPERATOR_ID,
    familyId: FAMILY_A,
    tokenHash,
    issuedAt: new Date(),
    expiresAt,
    revokedAt: null,
    revokedReason: null,
    replacedByTokenHash: null,
    driverActive: true,
  };
}

describe('RefreshTokenRepositoryImpl (pglite)', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;
  let repo: RefreshTokenRepositoryImpl;
  let driverId: string;
  const future = (): Date => new Date(Date.now() + 3_600_000);
  const past = (): Date => new Date(Date.now() - 3_600_000);

  // One PGlite boot per file: the WASM cold-compile is the expensive step and
  // a per-test boot melted down under parallel-terminal CPU contention (the
  // documented PGlite-under-contention failure mode; hook budget 60s was
  // exceeded by the FIRST boot only). Per-test isolation is TRUNCATE + reseed.
  beforeAll(async () => {
    pg = new PGlite();
    for (const stmt of DDL) await pg.exec(stmt);
    db = drizzle(pg);
    repo = new RefreshTokenRepositoryImpl(db as never);
  });

  beforeEach(async () => {
    await pg.exec('TRUNCATE driver_refresh_token, driver');
    const r = await pg.query(
      'INSERT INTO driver (company_id, business_unit_id, depot_id, legal_entity_id, full_name, operator_id, active) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING driver_id',
      [TENANCY.companyId, TENANCY.businessUnitId, TENANCY.depotId, TENANCY.legalEntityId, 'TAI XE PGLITE', OPERATOR_ID],
    );
    const row = (r.rows as { driver_id: string }[])[0];
    if (row === undefined) throw new Error('driver insert returned no row');
    driverId = row.driver_id;
  });

  it('insert persists the record without the driverActive projection', async () => {
    await repo.insert(record(driverId, 'a'.repeat(64), future()));
    const rows = await db.select().from(driverRefreshToken)
      .where(eq(driverRefreshToken.tokenHash, 'a'.repeat(64)));
    const row = rows[0];
    if (row === undefined) throw new Error('expected inserted row');
    expect(row.familyId).toBe(FAMILY_A);
    expect(row.revokedAt).toBeNull();
    expect(row.driverId).toBe(driverId);
  });

  it('claimForRotation atomically revokes the live row and returns it with driverActive', async () => {
    await repo.insert(record(driverId, 'b'.repeat(64), future()));
    const nowMs = Date.now();
    const claimed = await repo.claimForRotation('b'.repeat(64), 'c'.repeat(64), nowMs);
    expect(claimed).not.toBeNull();
    expect(claimed?.driverActive).toBe(true);
    expect(claimed?.familyId).toBe(FAMILY_A);
    const rows = await db.select().from(driverRefreshToken)
      .where(eq(driverRefreshToken.tokenHash, 'b'.repeat(64)));
    const row = rows[0];
    if (row === undefined) throw new Error('expected claimed row');
    expect(row.revokedReason).toBe('rotated');
    expect(row.replacedByTokenHash).toBe('c'.repeat(64));
    expect(row.revokedAt?.getTime()).toBe(nowMs);
  });

  it('claimForRotation is single-use: the second sequential claim returns null', async () => {
    await repo.insert(record(driverId, 'd'.repeat(64), future()));
    const first = await repo.claimForRotation('d'.repeat(64), 'e'.repeat(64), Date.now());
    const second = await repo.claimForRotation('d'.repeat(64), 'f'.repeat(64), Date.now());
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('claimForRotation refuses an expired row and leaves it untouched', async () => {
    await repo.insert(record(driverId, 'g'.repeat(64), past()));
    const claimed = await repo.claimForRotation('g'.repeat(64), 'h'.repeat(64), Date.now());
    expect(claimed).toBeNull();
    const rows = await db.select().from(driverRefreshToken)
      .where(and(eq(driverRefreshToken.tokenHash, 'g'.repeat(64)), isNull(driverRefreshToken.revokedAt)));
    expect(rows).toHaveLength(1);
  });

  it('claimForRotation surfaces driverActive=false for a disabled driver', async () => {
    await repo.insert(record(driverId, 'i'.repeat(64), future()));
    await db.update(driver).set({ active: false }).where(eq(driver.driverId, driverId));
    const claimed = await repo.claimForRotation('i'.repeat(64), 'j'.repeat(64), Date.now());
    expect(claimed).not.toBeNull();
    expect(claimed?.driverActive).toBe(false);
  });

  it('findByTokenHash returns the row with driverActive, and null when absent', async () => {
    await repo.insert(record(driverId, 'k'.repeat(64), future()));
    const found = await repo.findByTokenHash('k'.repeat(64));
    expect(found?.tokenHash).toBe('k'.repeat(64));
    expect(found?.driverActive).toBe(true);
    const missing = await repo.findByTokenHash('z'.repeat(64));
    expect(missing).toBeNull();
  });

  it('revokeFamily revokes only live rows of that family and preserves prior reasons', async () => {
    await repo.insert(record(driverId, 'l'.repeat(64), future()));
    await repo.insert(record(driverId, 'm'.repeat(64), future()));
    await repo.claimForRotation('l'.repeat(64), 'n'.repeat(64), Date.now());
    await repo.revokeFamily(FAMILY_A, 'reuse-detected', Date.now());
    const rows = await db.select().from(driverRefreshToken);
    const rotated = rows.find((r) => r.tokenHash === 'l'.repeat(64));
    const swept = rows.find((r) => r.tokenHash === 'm'.repeat(64));
    expect(rotated?.revokedReason).toBe('rotated');
    expect(swept?.revokedReason).toBe('reuse-detected');
    expect(swept?.revokedAt).not.toBeNull();
  });

  it('revokeByTokenHash revokes exactly the presented token', async () => {
    await repo.insert(record(driverId, 'o'.repeat(64), future()));
    await repo.insert(record(driverId, 'p'.repeat(64), future()));
    await repo.revokeByTokenHash('o'.repeat(64), 'logout', Date.now());
    const rows = await db.select().from(driverRefreshToken);
    const revoked = rows.find((r) => r.tokenHash === 'o'.repeat(64));
    const untouched = rows.find((r) => r.tokenHash === 'p'.repeat(64));
    expect(revoked?.revokedReason).toBe('logout');
    expect(untouched?.revokedAt).toBeNull();
  });
});
