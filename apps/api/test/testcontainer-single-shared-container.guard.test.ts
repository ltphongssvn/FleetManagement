// apps/api/test/testcontainer-single-shared-container.guard.test.ts
// STRUCTURAL GUARD (recurrence prevention, 2026 single-shared-container pattern).
//
// Root cause of the recurring beforeAll testcontainer-startup timeouts: the test
// suite used a PER-FILE container model — every integration file started/attached
// its own Postgres container inside beforeAll. Under parallel load many files race
// to start the container and whichever loses the race times out its own beforeAll.
// Raising per-file timeouts only moves the threshold; it is a treadmill.
//
// The durable fix is to start the Postgres container EXACTLY ONCE in Vitest
// globalSetup (before any worker, off the per-file critical path) and have every
// file attach to it via a per-file database. This guard makes that invariant
// permanent: NO test file may construct `new PostgreSqlContainer` directly. Only
// the single designated globalSetup module is allowed to. If a future change
// reintroduces a per-file container, this test fails in CI — the anti-pattern can
// never silently return.
//
// (This is the test-infra analogue of the schema-first SSOT rule: one place owns
// the container; everyone else derives from it.)
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// The ONE module permitted to construct the shared container.
const ALLOWED_CONTAINER_OWNER = 'pg-global-setup.ts';

// Recursively collect every .ts file under the test directory.
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

// Match a real constructor call, not a mention in a comment/string. We look for
// `new PostgreSqlContainer` on a line that is not a // comment.
function constructsContainer(source: string): boolean {
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('//') || line.startsWith('*')) continue;
    if (line.includes('new PostgreSqlContainer')) return true;
  }
  return false;
}

describe('@fleet/api - single-shared-container structural guard', () => {
  it('only the designated globalSetup module constructs new PostgreSqlContainer', () => {
    const testDir = resolve(here, '..');
    const files = collectTsFiles(testDir);
    const offenders = files
      .filter((f) => constructsContainer(readFileSync(f, 'utf8')))
      .map((f) => f.slice(testDir.length + 1))
      // The single owner + this guard file itself (which names the class in prose)
      // are exempt.
      .filter((rel) => !rel.endsWith(ALLOWED_CONTAINER_OWNER))
      .filter((rel) => !rel.endsWith('testcontainer-single-shared-container.guard.test.ts'))
      // The pre-start reap guard asserts on indexOf('new PostgreSqlContainer')
      // to pin the reap-before-construct ordering; it references the class
      // name in an assertion string, not a constructor call. Same class of
      // exemption as this guard file itself.
      .filter((rel) => !rel.endsWith('pg-global-setup-preflight-reap-guard.test.ts'));
    expect(offenders).toEqual([]);
  });
});
