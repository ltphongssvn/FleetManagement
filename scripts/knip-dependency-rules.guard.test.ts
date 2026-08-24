// scripts/knip-dependency-rules.guard.test.ts
// Guard: the knip DEPENDENCY axis stays at error, and the exports axis stays
// honestly at warn.
//
// WHY. knip's adoption guide burns down files -> dependencies -> exports, and a
// rule is only meaningful once its findings are at zero. Both earlier stages
// are there, so five rules are promoted. A silent demotion back to warn would
// leave the task passing while a dependency rots -- the decorative-control
// shape this repo has closed seven times, one config key instead of one task.
//
// The exports assertion is not padding. Promoting exports before its 284
// findings are triaged would make the task fail on day one and teach everyone
// to bypass it, which is the adoption reasoning //#typecheck:scripts and
// //#knip both record. Asserting it stays warn keeps a future edit from
// "finishing the job" by flipping a flag rather than doing the work.
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonc } from '@fleet/test-fixtures';

const here = dirname(fileURLToPath(import.meta.url));
const KNIP = resolve(here, '..', 'knip.jsonc');

interface KnipConfig {
  readonly rules?: Record<string, string>;
  readonly workspaces?: Record<string, { readonly ignoreBinaries?: readonly string[] }>;
}

function rules(): Record<string, string> {
  return (readJsonc(KNIP) as KnipConfig).rules ?? {};
}

describe('knip dependency rules are enforced, not advisory', () => {
  // Vacuity guard FIRST: an empty rules table would make every toBe('error')
  // below fail confusingly rather than report the real state.
  it('knip.jsonc parses with a populated rules table', () => {
    expect(Object.keys(rules()).length).toBeGreaterThan(8);
  });

  it('every dependency-axis rule is error', () => {
    const r = rules();
    for (const rule of ['dependencies', 'devDependencies', 'unlisted', 'unresolved', 'binaries']) {
      expect(r[rule]).toBe('error');
    }
  });

  // Stage 1, already complete before this arc; asserted so it cannot regress.
  it('files stays error', () => {
    expect(rules()['files']).toBe('error');
  });

  // Stage 3 is NOT done. Flipping this to error without triaging the findings
  // would make //#knip fail on every branch.
  it('exports and types stay warn until stage 3 is actually done', () => {
    const r = rules();
    expect(r['exports']).toBe('warn');
    expect(r['types']).toBe('warn');
  });

  // The drizzle-kit binary ignore is scoped to the ROOT workspace on purpose:
  // scripts/db-generate.ts runs with cwd apps/api, where drizzle-kit IS
  // declared. A global ignore would also exempt a workspace that spawns it
  // without declaring it, which is a real finding.
  it('the drizzle-kit binary ignore is scoped to the root workspace only', () => {
    const cfg = readJsonc(KNIP) as KnipConfig;
    expect(cfg.workspaces?.['.']?.ignoreBinaries).toContain('drizzle-kit');
    for (const [name, ws] of Object.entries(cfg.workspaces ?? {})) {
      if (name === '.') continue;
      expect(ws.ignoreBinaries ?? []).not.toContain('drizzle-kit');
    }
  });
});
