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
const EXEMPT = new Set([
  'commands.gateway.integration.test.ts',
  'otel.integration.test.ts',
  'migrations.integration.test.ts',
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
      expect(content).toMatch(/from '\.\/helpers\/migrate-test-db/);
    }
  });

  it('all schema integration tests contain no inline DDL (CREATE/DROP/ALTER)', async () => {
    const files = await listSchemaIntegrationFiles();
    for (const f of files) {
      const content = await readFile(resolve(testDir, f), 'utf-8');
      // Strip line comments before scanning so accepted tests can mention DDL in prose.
      const stripped = content.replace(/^\s*\/\/.*$/gm, '');
      expect(stripped, `${f} contains forbidden DDL`).not.toMatch(FORBIDDEN_DDL);
    }
  });
});
