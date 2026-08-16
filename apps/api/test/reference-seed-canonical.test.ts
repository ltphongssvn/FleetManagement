// apps/api/test/reference-seed-canonical.test.ts
// RED-first: the seed must write CANONICAL driver names, and must match
// existing rows on the canonical form when deciding whether to insert.
//
// INCIDENT THIS CLOSES. reference-seed.ts inserted fullName RAW --
// `fullName: t.driverName`, no DriverNameSchema -- with onConflictDoNothing
// and no conflict target. Production held the real NGUYEN AN BINH DUC with a
// TRAILING SPACE, so lower(full_name) did not match the canonical seed
// literal, no conflict was detected, and a second bare row was inserted: no
// phone, no vehicle, no device. main.ts runs this seed on EVERY boot when
// DB_AUTO_MIGRATE=true, and its isProduction flag gates only the login driver,
// never the TRUCKS loop. Soft-deleting the twin dropped it out of the partial
// index, so the next deploy inserted it again -- the dispatcher's "it stayed
// there forever".
//
// TWO INDEPENDENT GUARANTEES ARE ASSERTED HERE, because either alone is
// insufficient:
//   1. Every name the seed writes is already canonical. Migration
//      20260810180000 adds a CHECK that REFUSES a non-canonical name, so a
//      future edit introducing a stray space would otherwise crash the API at
//      BOOT -- the seed runs before the app listens. Normalizing at the seed
//      makes that unreachable rather than merely unlikely.
//   2. The insert is conflict-TARGETED on the driver identity, so it is a real
//      upsert rather than a blind insert whose "do nothing" never fires.
import { describe, it, expect } from 'vitest';
import { seedReference } from '../src/database/seeds/reference-seed.js';
import { normalizeDisplayName } from '@fleet/domain';
import type { FleetDb } from '../src/database/database.module.js';

interface CapturedInsert {
  readonly table: string;
  readonly values: Record<string, unknown>;
  readonly conflict: 'do-nothing' | 'do-update';
  readonly target?: unknown;
}

function makeFakeDb(captured: CapturedInsert[]): FleetDb {
  const tableNameOf = (t: unknown): string => {
    const sym = Object.getOwnPropertySymbols(t as object).find(
      (s) => s.description === 'drizzle:Name',
    );
    return sym ? String((t as Record<symbol, unknown>)[sym]) : 'unknown';
  };
  return {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: (cfg?: { target?: unknown }) => {
          captured.push({ table: tableNameOf(table), values, conflict: 'do-nothing', target: cfg?.target });
          return Promise.resolve();
        },
        onConflictDoUpdate: (cfg: { set: Record<string, unknown>; target?: unknown }) => {
          captured.push({ table: tableNameOf(table), values, conflict: 'do-update', target: cfg.target });
          return Promise.resolve();
        },
      }),
    }),
  } as unknown as FleetDb;
}

async function seededDriverNames(isProduction: boolean): Promise<string[]> {
  const captured: CapturedInsert[] = [];
  await seedReference(makeFakeDb(captured), { isProduction });
  return captured
    .filter((c) => c.table === 'driver')
    .map((c) => String(c.values['fullName']));
}

describe('seedReference - canonical driver names', () => {
  it('writes only canonical names in production', async () => {
    const names = await seededDriverNames(true);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n).toBe(normalizeDisplayName(n));
  });

  it('writes only canonical names outside production (login driver included)', async () => {
    const names = await seededDriverNames(false);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n).toBe(normalizeDisplayName(n));
  });

  it('routes every seeded name through normalizeDisplayName, not the raw literal', async () => {
    // Proven by construction rather than by inspection: normalizing an already
    // canonical name is a no-op, so equality alone cannot distinguish "the seed
    // normalizes" from "the literals happen to be clean today". The source must
    // therefore not interpolate the raw field into the insert.
    const raw = await import('node:fs').then((fs) =>
      fs.readFileSync('src/database/seeds/reference-seed.ts', 'utf8'));
    // Assert on CODE, not on the file as text. The header documents the old
    // defect verbatim, so a naive source grep would match that prose and the
    // test would fail on its own explanation -- or, worse, pass later because
    // someone deleted the comment. Comment lines are stripped first.
    const code = raw
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(code).toContain('normalizeDisplayName(t.driverName)');
    expect(code).toContain('normalizeDisplayName(d.fullName)');
    expect(code).not.toContain('fullName: t.driverName');
  });

  it('names NO conflict target for the reference driver insert', async () => {
    // This assertion is INVERTED from its first form, and the inversion is the
    // lesson. It originally demanded a target be present, which a fake db
    // happily satisfied -- while Postgres rejected that same target with 42P10,
    // there is no unique or exclusion constraint matching the ON CONFLICT
    // specification, because the name index is an EXPRESSION index over the
    // canonical fold and no index on (company_id, full_name) exists. The seed
    // runs at BOOT, so that error was the API exiting 1, not a failed query.
    // A bare do-nothing lets ANY unique violation be the no-op, which keeps the
    // seed decoupled from index internals. reference-seed.integration.test.ts
    // is what actually proves it against a real database; this only pins the
    // shape so the coupling cannot be reintroduced by edit.
    const captured: CapturedInsert[] = [];
    await seedReference(makeFakeDb(captured), { isProduction: true });
    const refDriver = captured.find((c) => c.table === 'driver');
    expect(refDriver).toBeDefined();
    expect(refDriver?.conflict).toBe('do-nothing');
    expect(refDriver?.target).toBeUndefined();
  });
});
