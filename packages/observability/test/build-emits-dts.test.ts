// packages/observability/test/build-emits-dts.test.ts
// outside-in strict TDD RED (L1): the build MUST emit dist/index.d.ts even when
// a stale .tsbuildinfo is present. tsc -b with composite+incremental skips
// re-emitting declarations if it finds an up-to-date tsbuildinfo (elevenlabs#595,
// nrwl#35079). turbo cache restores dist/ but historically not the matching
// tsbuildinfo, and `turbo --force` only bypasses turbo's cache, not tsc's own
// incremental cache -- so CI linted consumers against absent .d.ts, resolving
// @fleet/observability imports to `any` and tripping no-unsafe-*. This proves
// the build is deterministic regardless of pre-existing tsbuildinfo.
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const dts = resolve(pkgRoot, 'dist/index.d.ts');
describe('observability build emits declarations deterministically', () => {
  beforeAll(() => {
    // Reproduce the real CI hazard precisely: (1) a full build produces a VALID,
    // up-to-date tsbuildinfo + dist/. (2) turbo restores cached dist/ on a later
    // run but the matching .d.ts can be absent, while the VALID tsbuildinfo
    // survives in the package root. (3) the next tsc -b reads that valid
    // tsbuildinfo, sees inputs unchanged, and SKIPS emit -> .d.ts never created.
    // We simulate (2) by deleting only dist/ AFTER a real build, leaving the
    // genuine tsbuildinfo, then rebuilding. A correct build script must still
    // emit dist/index.d.ts.
    execSync('pnpm run build', { cwd: pkgRoot, stdio: 'inherit' });
    rmSync(resolve(pkgRoot, 'dist'), { recursive: true, force: true });
    execSync('pnpm run build', { cwd: pkgRoot, stdio: 'inherit' });
  });
  it('emits dist/index.d.ts after a build with a pre-existing stale tsbuildinfo', () => {
    expect(existsSync(dts)).toBe(true);
  });
});
