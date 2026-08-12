// apps/api/test/reference-seed.integration.test.ts
// RED-first: seedReference must run successfully against a REAL migrated
// database, twice, without creating duplicate drivers.
//
// THE GAP THIS CLOSES. reference-seed-canonical.test.ts drives the seed through
// a FAKE db that records calls. A fake accepts any conflict target, so it
// happily recorded onConflictDoNothing({ target: [companyId, fullName] }) and
// asserted the target was "defined" -- while Postgres rejects that target with
// 42P10, there is no unique or exclusion constraint matching the ON CONFLICT
// specification, because no unique index on (company_id, full_name) exists.
// The real indexes are an EXPRESSION index on the canonical folded name and a
// PARTIAL one on phone; Postgres infers the arbiter index from the target, so a
// partial index additionally requires the statement WHERE to imply the index
// predicate, and an expression index requires the expression restated verbatim.
//
// main.ts runs this seed at BOOT, before the app listens, so that 42P10 is not
// a failed query -- it is the API process exiting 1. CI showed only
// "fleet-pilot-api-1 exited (1)" with no container log, which is precisely why
// the verification has to live here, where the failure names itself.
//
// The seed deliberately uses a BARE DO NOTHING. Restating the canonical
// expression and the partial predicate in the seed would re-couple it to index
// internals, so that a future index change silently breaks boot again. With no
// target Postgres treats ANY unique violation as do-nothing, which is what a
// seed wants: the canonical index does the matching. That only became correct
// once both sides are canonical -- the original defect was never a missing
// target, it was that the twin violated NOTHING because the keys differed.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { seedReference } from '../src/database/seeds/reference-seed.js';
import { driver } from '../src/database/schema/reference.js';
import {
  startMigratedTestDb,
  stopMigratedTestDb,
  type MigratedTestDb,
  truncateAllTables,
} from './helpers/migrate-test-db.js';

let testDb: MigratedTestDb;
const SEED_COMPANY = '00000000-0000-0000-0000-000000000000';

async function activeDriverNames(): Promise<string[]> {
  const rows = await testDb.db.select({ fullName: driver.fullName })
    .from(driver)
    .where(eq(driver.companyId, SEED_COMPANY));
  return rows.map((r) => r.fullName);
}

describe('@fleet/api - seedReference against a migrated database', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_seedreal'); });
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => { await truncateAllTables(testDb.db); });

  it('runs to completion in production mode -- the boot path', async () => {
    await expect(seedReference(testDb.db, { isProduction: true })).resolves.toBeUndefined();
    expect((await activeDriverNames()).length).toBeGreaterThan(0);
  });

  it('runs to completion in non-production mode (login driver included)', async () => {
    await expect(seedReference(testDb.db, { isProduction: false })).resolves.toBeUndefined();
    const names = await activeDriverNames();
    expect(names.length).toBeGreaterThan(0);
  });

  it('is idempotent across boots -- a second run adds no rows', async () => {
    // This is the deploy loop that caused the incident: the seed runs on EVERY
    // boot. A second run must be a no-op, not a second identity.
    await seedReference(testDb.db, { isProduction: true });
    const first = await activeDriverNames();
    await seedReference(testDb.db, { isProduction: true });
    const second = await activeDriverNames();
    expect(second.length).toBe(first.length);
  });

  it('creates no duplicate names under the canonical fold', async () => {
    await seedReference(testDb.db, { isProduction: true });
    const names = await activeDriverNames();
    const folded = names.map((n) => n.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase());
    expect(new Set(folded).size).toBe(folded.length);
  });

  it('every seeded name satisfies the canonical CHECK constraint', async () => {
    await seedReference(testDb.db, { isProduction: true });
    const res = await testDb.db.execute(sql`
      SELECT count(*)::int AS bad
      FROM driver
      WHERE full_name <> btrim(regexp_replace(normalize(full_name, NFC), '\s+', ' ', 'g'))
    `);
    expect(res.rows[0]?.['bad']).toBe(0);
  });

  it('does NOT insert a twin when a pre-existing row is already canonical', async () => {
    // The seed literal and the stored row now fold identically, so the bare
    // DO NOTHING resolves against the canonical index -- the exact behaviour
    // whose absence produced a new twin on every deploy.
    const name = 'NGUY\u1ec4N AN B\u00ccNH \u0110\u1ee8C';
    await testDb.db.insert(driver).values({
      companyId: SEED_COMPANY,
      businessUnitId: SEED_COMPANY,
      depotId: SEED_COMPANY,
      legalEntityId: SEED_COMPANY,
      fullName: name,
      phone: '0907606776',
    });
    await seedReference(testDb.db, { isProduction: true });
    const matches = (await activeDriverNames()).filter((n) => n === name);
    expect(matches).toHaveLength(1);
  });
});
