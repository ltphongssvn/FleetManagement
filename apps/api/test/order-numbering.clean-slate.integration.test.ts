// apps/api/test/order-numbering.clean-slate.integration.test.ts
// L5 operational invariant (2026-Q2 squash): the codebase carries NO
// references to the legacy 'XT' order-numbering prefix anywhere in the
// migrations directory. The squash-and-replace pattern says: once we have
// committed to XTT.MM-NNN, every legacy seed/pad migration that injected
// 'XT' rows is deleted from the migrations folder and its journal entry
// removed, so a freshly provisioned tenant starts from a clean XTT-only
// world with zero dead code paths.
//
// Why this is a test, not just a manual cleanup: the migrations folder is
// the single source of truth for schema state on a fresh database. If any
// future contributor reintroduces an XT migration (copy-paste, revert,
// rebase mistake), this test fails immediately and surfaces the drift
// before it lands on develop.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../src/database/migrations');
let testDb: PgliteTestDb;
describe('@fleet/api - clean-slate XTT.MM-NNN squash (T3 2026-Q2)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('no migration .sql file in the repo references the legacy XT prefix in an INSERT or UPDATE', () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    const offenders: string[] = [];
    for (const f of files) {
      const c = readFileSync(resolve(migrationsDir, f), 'utf8');
      // Match seed/update statements that target the legacy XT prefix.
      // Allow the string 'XT' to appear in comments (lines starting with --).
      const codeOnly = c.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n');
      if (/\bprefix\s*=\s*'XT'\b/i.test(codeOnly) || /'XT'\s*,\s*\d/.test(codeOnly)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
  it('no order_number_seq legacy migration ships in the folder', () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    const legacy = files.filter((f) => f.endsWith('order_number_seq.sql') || f.endsWith('pad_width_default_4.sql'));
    expect(legacy).toEqual([]);
  });
  it('after fresh migrate, order_sequence contains exactly one row and its prefix is XTT', async () => {
    const r = await testDb.db.execute<{ prefix: string; pad_width: number; next_value: number }>(
      sql.raw('SELECT prefix, pad_width, next_value FROM order_sequence ORDER BY prefix'),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0]?.prefix).toBe('XTT');
    expect(r.rows[0]?.pad_width).toBe(3);
    expect(r.rows[0]?.next_value).toBe(1);
  });
});
