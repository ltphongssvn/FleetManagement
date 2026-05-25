// apps/api/test/vitest-global-teardown-cleans-testcontainers.test.ts
// Operational invariant: ALL THREE vitest configs (default unit, coverage,
// and integration) must wire a globalTeardown hook that prunes leftover
// Docker containers labeled org.testcontainers=true. Without this on any
// one of them, an aborted run from the un-wired config orphans postgres
// containers — over weeks of CI runs the host accumulates dozens. The
// default vitest.config.ts file matches *.test.ts which excludes only
// '*.integration.test.ts' — many *.test.ts files in this codebase ALSO
// use startMigratedTestDb (Testcontainers), so the unit run is just as
// leaky as the integration run.
//
// The Testcontainers Reaper (ryuk) is meant to handle this on its own,
// but in WSL2 + Docker Desktop + .withReuse() scenarios the Reaper
// sometimes outlives the test process and never receives the disconnect
// signal — the globalTeardown is the belt-and-braces guard.
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '..');
const CONFIGS = [
  'vitest.config.ts',
  'vitest.integration.config.ts',
  'vitest.coverage.config.ts',
];
const GLOBAL_SETUP_RE = /globalSetup\s*:\s*\[?\s*['"]([^'"]+)['"]/;
describe('@fleet/api - vitest configs wire globalSetup to prune testcontainers', () => {
  for (const cfgName of CONFIGS) {
    it(cfgName + ' declares globalSetup pointing at a file that exists', () => {
      const cfgPath = resolve(apiRoot, cfgName);
      const cfg = readFileSync(cfgPath, 'utf8');
      const m = GLOBAL_SETUP_RE.exec(cfg);
      expect(m).not.toBeNull();
      if (!m) return;
      const setupPath = resolve(apiRoot, m[1]);
      expect(existsSync(setupPath)).toBe(true);
    });
  }
  it('the globalSetup module references the org.testcontainers label and removes containers', () => {
    const cfg = readFileSync(resolve(apiRoot, 'vitest.config.ts'), 'utf8');
    const m = GLOBAL_SETUP_RE.exec(cfg);
    if (!m) throw new Error('globalSetup not configured');
    const src = readFileSync(resolve(apiRoot, m[1]), 'utf8');
    expect(src).toMatch(/org\.testcontainers/);
    expect(src).toMatch(/(rm|remove|stop)/i);
  });
});
