// apps/driver-app/test/storage-schema-drift.guard.test.ts
// A FITNESS FUNCTION: the Drizzle schema and the startup DDL must describe the
// SAME tables. Not what the code computes -- how the code is organized.
//
// WHY IT EXISTS. schema.ts is the SSOT for the local store, and migrate.ts
// applies hand-written CREATE TABLE statements at app startup. Two independent
// descriptions of one shape, with NOTHING binding them: add a column to
// schema.ts and everything compiles, while the DDL silently keeps the old
// table. On a driver's phone that surfaces as a query against a column that
// does not exist -- offline, mid-shift, with no recovery path.
//
// THE PROPER FIX IS drizzle-kit generate, which DERIVES the DDL from the
// schema so the second description cannot exist. That pipeline is absent here
// (no drizzle.config.ts, no drizzle/ folder, no .sql files, no migrate() call,
// no .sql in Metro sourceExts, no babel.config.js) and building it touches the
// Metro and Babel configs mobile-native-bundle-config.test.ts pins, so it is
// its own device-verified arc. Until then, the gap must be ENFORCED rather
// than documented: "if a rule exists only in documentation or team knowledge,
// it is a candidate for a fitness function -- the gap between what is written
// and what is enforced is where decay happens."
//
// IT PASSES TODAY, deliberately. The two descriptions currently agree, so this
// is a ratchet and not a born-red gate -- the adoption failure this repo
// documents for //#typecheck:scripts and //#knip. It turns red only when
// someone changes one side and not the other, which is exactly the moment a
// human should look.
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { localActionLog, syncCursor, ACTION_STATUSES } from '../src/storage/schema.js';
import { STARTUP_DDL } from '../src/storage/migrate.js';

const DDL = STARTUP_DDL.join('\n');

/** Column names Drizzle will actually read/write for a table. */
function schemaColumns(table: typeof localActionLog | typeof syncCursor): string[] {
  return getTableConfig(table).columns.map((c) => c.name).sort();
}

/** Column names the startup DDL declares for one CREATE TABLE block. */
function ddlColumns(tableName: string): string[] {
  const block = new RegExp(
    'CREATE TABLE IF NOT EXISTS ' + tableName + '\\s*\\(([\\s\\S]*?)\\n\\);',
  ).exec(DDL);
  const body = block?.[1] ?? '';
  const names: string[] = [];
  for (const line of body.split('\n')) {
    const m = /^\s{2}([a-z_]+)\s+(TEXT|INTEGER)\b/.exec(line);
    if (m?.[1] !== undefined) names.push(m[1]);
  }
  return names.sort();
}

describe('the startup DDL matches the Drizzle schema', () => {
  // Vacuity guard FIRST: a parse that finds nothing would make every
  // comparison below trivially true -- the confident zero this repo refuses.
  it('the DDL parse finds columns at all', () => {
    expect(ddlColumns('local_action_log').length).toBeGreaterThan(5);
    expect(ddlColumns('sync_cursor').length).toBeGreaterThan(2);
  });

  it('local_action_log declares exactly the schema columns', () => {
    expect(ddlColumns('local_action_log')).toEqual(schemaColumns(localActionLog));
  });

  it('sync_cursor declares exactly the schema columns', () => {
    expect(ddlColumns('sync_cursor')).toEqual(schemaColumns(syncCursor));
  });

  // The status vocabulary is now DERIVED from the schema export rather than
  // restated, so this asserts the derivation actually reached the SQL.
  it('the status CHECK carries every schema status', () => {
    for (const status of ACTION_STATUSES) {
      expect(DDL).toContain("'" + status + "'");
    }
  });

  // ...and carries NOTHING else: a literal left behind after a rename would
  // otherwise sit in the CHECK accepting a value the schema no longer knows.
  it('the status CHECK carries no value the schema does not declare', () => {
    const check = /CHECK \(status IN \(([^)]*)\)\)/.exec(DDL)?.[1] ?? '';
    const declared = check.split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
    expect(declared.sort()).toEqual([...ACTION_STATUSES].sort());
  });

  // The FIFO invariant is the reason this table exists; losing the unique
  // index would let duplicate sequences through silently.
  it('the unique index the schema declares is present in the DDL', () => {
    const name = getTableConfig(localActionLog).indexes[0]?.config.name ?? 'MISSING';
    expect(name).not.toBe('MISSING');
    expect(DDL).toContain(name);
  });

  // Every table the schema knows must actually be created at startup.
  it('creates every table the schema declares', () => {
    for (const t of [localActionLog, syncCursor]) {
      expect(DDL).toContain('CREATE TABLE IF NOT EXISTS ' + getTableConfig(t).name);
    }
  });
});
