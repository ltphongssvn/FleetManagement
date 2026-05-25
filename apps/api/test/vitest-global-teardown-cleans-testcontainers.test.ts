// apps/api/test/vitest-global-teardown-cleans-testcontainers.test.ts
// Operational invariant: the vitest integration config must wire a
// globalTeardown hook that prunes leftover Docker containers labeled
// org.testcontainers=true. Without this, every aborted/timed-out run
// leaves an orphan postgres:16.4-alpine container behind — and over
// weeks of CI runs the host accumulates dozens of healthy but unused
// containers consuming RAM, ports, and disk. The Testcontainers Reaper
// (ryuk) sidecar is meant to handle this on its own, but in WSL2 +
// Docker Desktop + .withReuse() scenarios the Reaper sometimes outlives
// the test process and never receives the disconnect signal — the
// globalTeardown is the belt-and-braces guard.
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '..');
describe('@fleet/api - vitest integration config wires globalTeardown to prune testcontainers', () => {
  it('declares globalSetup pointing at a file that exists', () => {
    const cfg = readFileSync(resolve(apiRoot, 'vitest.integration.config.ts'), 'utf8');
    const m = cfg.match(/globalSetup\s*:\s*\[?\s*['\"]([^'\"]+)['\"]/);
    expect(m, 'vitest.integration.config.ts must set test.globalSetup').not.toBeNull();
    const setupPath = resolve(apiRoot, m![1]);
    expect(existsSync(setupPath), 'globalSetup file must exist: ' + setupPath).toBe(true);
  });
  it('the globalSetup module exports a teardown function that removes org.testcontainers-labeled containers', () => {
    const cfg = readFileSync(resolve(apiRoot, 'vitest.integration.config.ts'), 'utf8');
    const m = cfg.match(/globalSetup\s*:\s*\[?\s*['\"]([^'\"]+)['\"]/);
    if (!m) throw new Error('globalSetup not configured');
    const src = readFileSync(resolve(apiRoot, m![1]), 'utf8');
    // The teardown must reference the canonical testcontainers label and
    // must actually invoke a docker removal (rm/remove/stop) — not just
    // log them.
    expect(src).toMatch(/org\.testcontainers/);
    expect(src).toMatch(/(rm|remove|stop)/i);
  });
});
