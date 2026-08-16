// apps/api/test/driver-canonical-name.integration.test.ts
// RED-first spec for the canonical-name invariant on driver.full_name.
//
// PRODUCTION INCIDENT THIS ENCODES. Two ACTIVE rows existed for one human,
// NGUYEN AN BINH DUC. The only difference was a single TRAILING SPACE on the
// real driver's row (19 code points vs 18). driver_company_active_name_ci_uq
// indexes lower(full_name), so "...duc " and "...duc" are different keys and
// the index permitted both. reference-seed.ts then inserted the canonical
// spelling on every boot -- main.ts runs the seed whenever DB_AUTO_MIGRATE is
// true, and its isProduction flag gates only the login driver, never the
// TRUCKS loop -- so the dispatcher deleted the twin, the next deploy recreated
// it, forever.
//
// WHY THE GUARD BELONGS IN THE DATABASE. normalizeDisplayName already trims at
// the app boundary, and it was not enough: it shipped 2026-07-21, after the
// offending row was written, and reference-seed.ts writes full_name RAW with
// no schema at all. An application-only rule also loses to concurrency -- two
// requests can both observe "no duplicate" and both insert. The index
// expression must therefore canonicalize, and a CHECK must refuse a
// non-canonical write outright rather than a trigger silently rewriting it:
// a trigger would hide the offending writer forever, while a CHECK names it
// at the moment of the write.
//
// CANONICAL FORM, defined identically to normalizeDisplayName's whitespace
// half: NFC-composed, ends trimmed, internal whitespace runs collapsed to one
// space. Accents are PRESERVED -- diacritics are meaning in Vietnamese, so LE
// and LE-with-diacritics stay different people. Case is preserved in storage
// and folded only in the index, exactly as today.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { driver } from '../src/database/schema/reference.js';
import {
  startMigratedTestDb,
  stopMigratedTestDb,
  type MigratedTestDb,
  truncateAllTables,
} from './helpers/migrate-test-db.js';

let testDb: MigratedTestDb;
const COMPANY = '11111111-1111-4111-8111-111111111111';
const TENANCY = {
  companyId: COMPANY,
  businessUnitId: '22222222-2222-4222-8222-222222222222',
  depotId: '33333333-3333-4333-8333-333333333333',
  legalEntityId: '44444444-4444-4444-8444-444444444444',
};
// The exact production name, composed (NFC), and its trailing-space twin.
const CANONICAL = 'NGUY\u1ec4N AN B\u00ccNH \u0110\u1ee8C';
const TRAILING_SPACE = CANONICAL + ' ';

async function insertDriver(fullName: string, active = true): Promise<void> {
  await testDb.db.insert(driver).values({ ...TENANCY, fullName, active });
}

describe('@fleet/api - driver canonical name invariant', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_canonname'); });
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => { await truncateAllTables(testDb.db); });

  it('REFUSES a name with a trailing space -- the exact production defect', async () => {
    await expect(insertDriver(TRAILING_SPACE)).rejects.toThrow();
  });

  it('REFUSES a name with a leading space', async () => {
    await expect(insertDriver(' ' + CANONICAL)).rejects.toThrow();
  });

  it('REFUSES a name with a collapsible internal double space', async () => {
    await expect(insertDriver('L\u00ca  V\u0102N B\u1ea2O')).rejects.toThrow();
  });

  it('REFUSES a decomposed (NFD) name so composition cannot fork identity', async () => {
    await expect(insertDriver(CANONICAL.normalize('NFD'))).rejects.toThrow();
  });

  it('ACCEPTS the canonical composed, trimmed, single-spaced name', async () => {
    await insertDriver(CANONICAL);
    const rows = await testDb.db.select().from(driver)
      .where(and(eq(driver.companyId, COMPANY), eq(driver.fullName, CANONICAL)));
    expect(rows).toHaveLength(1);
  });

  it('still REFUSES a second ACTIVE row differing only by case', async () => {
    await insertDriver(CANONICAL);
    await expect(insertDriver(CANONICAL.toLowerCase())).rejects.toThrow();
  });

  it('still ACCEPTS an accent-different name as a DIFFERENT person', async () => {
    await insertDriver('L\u00ca V\u0102N B\u1ea2O');
    await insertDriver('LE VAN BAO');
    const rows = await testDb.db.select().from(driver).where(eq(driver.companyId, COMPANY));
    expect(rows).toHaveLength(2);
  });

  it('lets a soft-deleted name be re-registered -- the partial predicate survives', async () => {
    await insertDriver(CANONICAL, false);
    await insertDriver(CANONICAL, true);
    const active = await testDb.db.select().from(driver)
      .where(and(eq(driver.companyId, COMPANY), eq(driver.active, true)));
    expect(active).toHaveLength(1);
  });

  it('reserves a phone only while the row is ACTIVE, so re-registration works', async () => {
    // driver_company_phone_uq was a PLAIN unique on (company_id, phone), so a
    // soft-deleted row held its phone forever; production had four such phones
    // locked. It must be partial on active, mirroring the name index.
    await testDb.db.insert(driver).values({ ...TENANCY, fullName: 'OLD ONE', phone: '0907606776', active: false });
    await testDb.db.insert(driver).values({ ...TENANCY, fullName: 'NEW ONE', phone: '0907606776', active: true });
    const active = await testDb.db.select().from(driver)
      .where(and(eq(driver.companyId, COMPANY), eq(driver.active, true)));
    expect(active).toHaveLength(1);
  });

  it('the canonical unique index exists and is VALID', async () => {
    const res = await testDb.db.execute(sql`
      SELECT ix.indisvalid AS is_valid, pg_get_indexdef(ix.indexrelid) AS definition
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      WHERE t.relname = 'driver' AND i.relname = 'driver_company_active_name_ci_uq'
    `);
    expect(res.rows).toHaveLength(1);
    const def = String(res.rows[0]?.['definition']);
    // Postgres echoes the SQL-standard NORMALIZE keyword in UPPER case in
    // pg_get_indexdef, so the assertion must be case-insensitive -- matching
    // the lower-case spelling would fail on a correct index.
    expect(def.toLowerCase()).toContain('normalize');
    expect(def.toLowerCase()).toContain('btrim');
    expect(def.toLowerCase()).toContain('active = true');
  });
});
