// apps/api/test/driver-canonical-repair.integration.test.ts
// RED-first spec for the REPAIR half of migration 20260810180000.
//
// WHY A SEPARATE SPEC. driver-canonical-name.integration.test.ts proves the
// CONSTRAINT: once the migration has run, a non-canonical name is refused. It
// says nothing about the migration's first two statements, which must fix rows
// that ALREADY EXIST -- and those are the statements that will actually run
// against production, where four soft-deleted phones are locked and two ACTIVE
// twins are live. A migration whose constraint is proven but whose repair is
// not is a migration that fails on deploy.
//
// WHY IT REPLAYS THE SQL RATHER THAN THE MIGRATION. The test harness clones an
// already-migrated template database (per-file CREATE DATABASE ... TEMPLATE),
// so it cannot stop at migration N-1, seed dirt, and then apply N. The repair
// statements are pure data transformations, though, so running THEM against
// dirty rows exercises the identical logic. The CHECK is dropped first, which
// is precisely the state a pre-migration database is in -- otherwise the dirty
// fixtures could not be inserted at all, and the test would be vacuous.
//
// The SQL below is READ FROM THE MIGRATION FILE, never retyped. A hand-copied
// duplicate would drift from the migration it claims to verify, and would then
// prove something the deploy does not run.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
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
const CANONICAL = 'NGUY\u1ec4N AN B\u00ccNH \u0110\u1ee8C';

const MIGRATION = 'src/database/migrations/20260810180000_driver_canonical_name.sql';

// The migration's statements, split on its own breakpoint marker. Steps 1 and 2
// are the repair; the rest re-establish the constraints.
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function dropConstraints(): Promise<void> {
  // Restore the EXACT pre-migration schema, not merely a permissive one.
  //
  // The first version of this helper only DROPPED things, which made the
  // fixtures insertable and the tests pass -- against a schema state that
  // never occurs. Production runs the migration with the OLD lower(full_name)
  // unique index and the OLD plain phone unique STILL PRESENT, and that is
  // precisely what broke it: canonicalizing the trailing-space row makes it
  // collide with its bare twin under that old index, raising 23505 INSIDE the
  // migration transaction. The API exited 1 during maybeMigrate and production
  // was down until DB_AUTO_MIGRATE was set false.
  //
  // A migration test must reproduce the schema the migration will ENCOUNTER.
  // Dropping a constraint to make a fixture insertable silently changes the
  // thing under test.
  await testDb.db.execute(sql`ALTER TABLE driver DROP CONSTRAINT IF EXISTS driver_full_name_canonical`);
  await testDb.db.execute(sql`DROP INDEX IF EXISTS driver_company_active_name_ci_uq`);
  await testDb.db.execute(sql`DROP INDEX IF EXISTS driver_company_active_phone_uq`);
  // Drop the phone constraint too before recreating it: the cloned template
  // still carries it on a fresh database, and the migration drops it only on
  // the runs that have already executed. Idempotent setup, so beforeEach can
  // run this whether or not a prior test applied the migration.
  await testDb.db.execute(sql`ALTER TABLE driver DROP CONSTRAINT IF EXISTS driver_company_phone_uq`);
  // Recreate the pre-migration indexes verbatim.
  await testDb.db.execute(sql`CREATE UNIQUE INDEX driver_company_active_name_ci_uq ON driver (company_id, lower(full_name)) WHERE active = true`);
  await testDb.db.execute(sql`ALTER TABLE driver ADD CONSTRAINT driver_company_phone_uq UNIQUE (company_id, phone)`);
}

async function applyRepair(): Promise<void> {
  for (const stmt of migrationStatements()) {
    await testDb.db.execute(sql.raw(stmt));
  }
}

describe('@fleet/api - migration 20260810180000 repair path', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_test_canonrepair'); });
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    await truncateAllTables(testDb.db);
    await dropConstraints();
  });

  it('reads real statements from the migration file, not a retyped copy', () => {
    const stmts = migrationStatements();
    expect(stmts.length).toBeGreaterThanOrEqual(6);
    expect(stmts.join('\n')).toContain('normalize');
  });

  it('trims a trailing space on an existing row', async () => {
    await testDb.db.insert(driver).values({ ...TENANCY, fullName: CANONICAL + ' ', phone: '0907606776' });
    await applyRepair();
    const rows = await testDb.db.select().from(driver).where(eq(driver.companyId, COMPANY));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fullName).toBe(CANONICAL);
  });

  it('recomposes an existing NFD row to NFC', async () => {
    await testDb.db.insert(driver).values({ ...TENANCY, fullName: CANONICAL.normalize('NFD') });
    await applyRepair();
    const rows = await testDb.db.select().from(driver).where(eq(driver.companyId, COMPANY));
    expect(rows[0]?.fullName).toBe(CANONICAL);
  });

  it('KEEPS the operationally-rich twin and deactivates the bare one', async () => {
    // The exact production pair. The bare row was created first by the seed on
    // some earlier boot, so an age-based tiebreak would have kept IT and
    // deactivated the working driver -- stranding a real person's phone,
    // vehicle and device. Richness must win.
    await testDb.db.insert(driver).values({ ...TENANCY, fullName: CANONICAL, phone: null });
    await testDb.db.insert(driver).values({
      ...TENANCY,
      fullName: CANONICAL + ' ',
      phone: '0907606776',
      operatorId: '00000000-0000-0000-0000-0000000000cc',
    });
    await applyRepair();
    const active = await testDb.db.select().from(driver)
      .where(and(eq(driver.companyId, COMPANY), eq(driver.active, true)));
    expect(active).toHaveLength(1);
    expect(active[0]?.phone).toBe('0907606776');
    const all = await testDb.db.select().from(driver).where(eq(driver.companyId, COMPANY));
    expect(all).toHaveLength(2);
  });

  it('leaves a single clean row untouched', async () => {
    await testDb.db.insert(driver).values({ ...TENANCY, fullName: CANONICAL, phone: '0900000001' });
    await applyRepair();
    const rows = await testDb.db.select().from(driver).where(eq(driver.companyId, COMPANY));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.active).toBe(true);
    expect(rows[0]?.fullName).toBe(CANONICAL);
  });

  it('does not merge rows across companies', async () => {
    const OTHER = '99999999-9999-4999-8999-999999999999';
    await testDb.db.insert(driver).values({ ...TENANCY, fullName: CANONICAL + ' ' });
    await testDb.db.insert(driver).values({
      ...TENANCY, companyId: OTHER, fullName: CANONICAL,
    });
    await applyRepair();
    const mine = await testDb.db.select().from(driver)
      .where(and(eq(driver.companyId, COMPANY), eq(driver.active, true)));
    const theirs = await testDb.db.select().from(driver)
      .where(and(eq(driver.companyId, OTHER), eq(driver.active, true)));
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(1);
  });

  it('is idempotent -- a second application changes nothing', async () => {
    await testDb.db.insert(driver).values({ ...TENANCY, fullName: CANONICAL + ' ', phone: '0907606776' });
    await applyRepair();
    await dropConstraints();
    await applyRepair();
    const rows = await testDb.db.select().from(driver).where(eq(driver.companyId, COMPANY));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fullName).toBe(CANONICAL);
    expect(rows[0]?.active).toBe(true);
  });

  it('frees a phone held by a soft-deleted row once the partial index lands', async () => {
    await testDb.db.insert(driver).values({ ...TENANCY, fullName: 'OLD ONE', phone: '0384032759', active: false });
    await applyRepair();
    await testDb.db.insert(driver).values({ ...TENANCY, fullName: 'NEW ONE', phone: '0384032759', active: true });
    const active = await testDb.db.select().from(driver)
      .where(and(eq(driver.companyId, COMPANY), eq(driver.active, true)));
    expect(active).toHaveLength(1);
  });
});
