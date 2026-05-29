// apps/api/test/migrations.test.ts
import { describe, it, expect } from 'vitest';
import { access, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../src/database/migrations');

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('@fleet/api - Drizzle migrations', () => {
  it('migrations directory exists', async () => {
    expect(await exists(migrationsDir)).toBe(true);
  });

  it('contains at least one non-empty .sql migration file', async () => {
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const stats = await stat(resolve(migrationsDir, f));
      expect(stats.size).toBeGreaterThan(0);
    }
  });

  it('contains a meta directory with journal', async () => {
    expect(await exists(resolve(migrationsDir, 'meta'))).toBe(true);
    expect(await exists(resolve(migrationsDir, 'meta', '_journal.json'))).toBe(true);
  });

  it('drizzle.config.ts exists at apps/api root', async () => {
    expect(await exists(resolve(here, '../drizzle.config.ts'))).toBe(true);
  });
});
