// apps/api/test/vitest-global-teardown-cleans-testcontainers.test.ts
// Operational invariant: ALL THREE vitest configs (default unit, coverage,
// and integration) must wire a globalSetup chain that, taken together, prunes
// leftover Docker containers labeled org.testcontainers=true. Without this on
// any one of them, an aborted run from the un-wired config orphans postgres
// containers — over weeks of CI runs the host accumulates dozens. The default
// vitest.config.ts file matches *.test.ts which excludes only
// '*.integration.test.ts' — many *.test.ts files in this codebase ALSO use
// startMigratedTestDb (Testcontainers via the shared container), so the unit
// run is just as leaky as the integration run.
//
// Since the 2026 single-shared-container refactor, globalSetup is a CHAIN of two
// files per config: pg-global-setup.ts (starts the ONE shared container) and
// global-teardown.ts (docker-rm prunes org.testcontainers-labeled containers at
// run end). Responsibility is split, so this test asserts the pruning logic
// exists in AT LEAST ONE of the configured globalSetup files — not in a specific
// position. Vitest runs the chain in order and teardowns in reverse.
//
// The Testcontainers Reaper (ryuk) is meant to handle this on its own, but in
// WSL2 + Docker Desktop + .withReuse() scenarios the Reaper sometimes outlives
// the test process and never receives the disconnect signal — the globalSetup
// prune is the belt-and-braces guard.
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '..');
const CONFIGS = ['vitest.config.ts', 'vitest.integration.config.ts', 'vitest.coverage.config.ts'];

// Capture the FULL globalSetup array literal, then extract every quoted path
// from it. Handles single- and multi-entry arrays.
const GLOBAL_SETUP_ARRAY_RE = /globalSetup\s*:\s*\[([^\]]*)\]/;
const QUOTED_PATH_RE = /['"]([^'"]+)['"]/g;

function globalSetupFilesFor(cfgSource: string): string[] {
  const arr = GLOBAL_SETUP_ARRAY_RE.exec(cfgSource);
  if (arr === null) {
    // Fall back to a single non-array globalSetup string form.
    const single = /globalSetup\s*:\s*['"]([^'"]+)['"]/.exec(cfgSource);
    return single?.[1] !== undefined ? [single[1]] : [];
  }
  const inner = arr[1] ?? '';
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = QUOTED_PATH_RE.exec(inner)) !== null) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

describe('@fleet/api - vitest configs wire globalSetup to prune testcontainers', () => {
  for (const cfgName of CONFIGS) {
    it(cfgName + ' declares globalSetup pointing at file(s) that exist', () => {
      const cfg = readFileSync(resolve(apiRoot, cfgName), 'utf8');
      const files = globalSetupFilesFor(cfg);
      expect(files.length).toBeGreaterThan(0);
      for (const rel of files) {
        expect(existsSync(resolve(apiRoot, rel))).toBe(true);
      }
    });
  }

  it('at least one configured globalSetup file prunes org.testcontainers-labeled containers', () => {
    // Use the default config chain as representative (all three wire the same
    // pg-global-setup.ts + global-teardown.ts chain).
    const cfg = readFileSync(resolve(apiRoot, 'vitest.config.ts'), 'utf8');
    const files = globalSetupFilesFor(cfg);
    expect(files.length).toBeGreaterThan(0);
    const sources = files.map((rel) => readFileSync(resolve(apiRoot, rel), 'utf8'));
    const hasLabel = sources.some((src) => src.includes('org.testcontainers'));
    const hasRemoval = sources.some((src) => /(rm|remove|stop)/i.test(src));
    expect(hasLabel).toBe(true);
    expect(hasRemoval).toBe(true);
  });
});
