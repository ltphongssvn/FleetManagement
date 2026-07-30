// apps/api/test/integration-tests-use-migrations.test.ts
// Architectural test: DB-touching integration tests must use the shared
// migrate-test-db helper, NOT inline raw DDL. Migrations are the single
// source of truth for schema.
import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const testDir = here;

// Files that don't touch DB schema (commands gateway, otel) are excluded.
// migrations.integration.test.ts is the only file allowed to import the
// drizzle migrator directly — it tests the migrator itself.
// app.module.integration.test.ts is the whole-graph DI smoke (lane move,
// T17 2026-07-12): it dynamically imports AppModule and asserts definedness
// only -- no database, no schema source, so the migrate-helper rule does
// not apply (same class as the commands gateway and otel exemptions).
const EXEMPT = new Set([
  'app.module.integration.test.ts',
  'commands.gateway.integration.test.ts',
  'otel.integration.test.ts',
  'migrations.integration.test.ts',
  // app.module.integration.test.ts boots the full Nest graph for a DI
  // resolution smoke (moved out of the unit lane, where a whole-graph
  // import is a category error + recurring 60s timeout). It touches NO DB,
  // so the shared-helper / migrate rules do not apply -- same class as the
  // commands.gateway + otel exemptions above.
  'app.module.integration.test.ts',
]);

// NARROW, JUSTIFIED carve-out for the no-inline-DDL check ONLY (not the helper-usage
// check). These files DO use the migrate-test-db helper (and are still verified to),
// but they legitimately contain DDL keywords as STRING LITERALS that they assert are
// REJECTED — they do not use DDL to set up schema, which is what the guard forbids.
// This is the explicit approved-variant allowlist (the Semgrep pattern-not equivalent),
// preferred over broadly exempting the file or obscuring the SQL via concatenation.
//   * fleet-app-role-privileges.integration.test.ts asserts the least-privilege runtime
//     role (fleet_app) is DENIED DROP TABLE / ALTER TABLE (SQLSTATE 42501).
const DDL_ASSERTION_EXEMPT = new Set([
  'fleet-app-role-privileges.integration.test.ts',
]);

const FORBIDDEN_DDL = /\b(CREATE\s+TABLE|CREATE\s+TYPE|DROP\s+TABLE|ALTER\s+TABLE)\b/i;

async function listSchemaIntegrationFiles(): Promise<readonly string[]> {
  const all = await readdir(testDir);
  return all.filter((f) => f.endsWith('.integration.test.ts') && !EXEMPT.has(f));
}

describe('@fleet/api - integration tests use migrations as schema source', () => {
  it('migrations.integration.test.ts is the only file with the migrate() import', async () => {
    const files = (await readdir(testDir)).filter((f) => f.endsWith('.integration.test.ts'));
    const usingMigrate: string[] = [];
    for (const f of files) {
      const content = await readFile(resolve(testDir, f), 'utf-8');
      if (content.includes("from 'drizzle-orm/node-postgres/migrator'")) {
        usingMigrate.push(f);
      }
    }
    expect(usingMigrate).toEqual(['migrations.integration.test.ts']);
  });

  it('all schema integration tests use the shared migrate-test-db helper', async () => {
    const files = await listSchemaIntegrationFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const content = await readFile(resolve(testDir, f), 'utf-8');
      expect(content).toMatch(/from '\.\/helpers\/(migrate-test-db|pglite-test-db)/);
    }
  });

  it('all schema integration tests contain no inline DDL (CREATE/DROP/ALTER)', async () => {
    // Subject to the DDL-assertion carve-out: files that assert DDL is rejected (rather
    // than using it for setup) are checked against the helper-usage rule above but not
    // this literal-scan, since the forbidden tokens appear only inside asserted-denied
    // query strings.
    const files = (await listSchemaIntegrationFiles()).filter((f) => !DDL_ASSERTION_EXEMPT.has(f));
    for (const f of files) {
      const content = await readFile(resolve(testDir, f), 'utf-8');
      // Strip line comments before scanning so accepted tests can mention DDL in prose.
      const stripped = content.replace(/^\s*\/\/.*$/gm, '');
      expect(stripped, `${f} contains forbidden DDL`).not.toMatch(FORBIDDEN_DDL);
    }
  });
});
