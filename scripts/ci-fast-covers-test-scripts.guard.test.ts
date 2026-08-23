// scripts/ci-fast-covers-test-scripts.guard.test.ts
// Guard (root-cause fix): the root test:scripts suite -- which covers the
// repo-level tooling in scripts/ (sync-worktrees, close-worktree,
// worktree-close-cli, bump-pnpm, railway-reference-guard, db-generate) -- must
// run inside the __ci_fast__ PR gate, not only via a bare pnpm run test:scripts
// nobody invokes. Before this, scripts/ had passing vitest suites that the gate
// never executed, so a regression in the worktree-deletion logic (which can
// remove branches) could merge green. 2026 Turborepo practice: a repo-spanning
// check that owns no package is a root task (//# prefix); wiring it into the
// gate aggregate is how codemod:check and the sync:* tasks are already covered.
//
// This guard lives under scripts/ on purpose, so vitest run scripts executes it
// -- the gate it protects is the same suite that runs it.
//
// PARSING (2026-08-23). This file used to carry its own JSONC reader: drop every
// line whose first token is //, then JSON.parse. Its own comment noted that a
// trailing-comment strip would corrupt task names like //#test:scripts -- and
// then the whole-line strip did precisely that, deleting all 47 root-task
// definitions before parsing. The guard was inspecting a config with its subject
// removed and passing anyway, because nothing asserted the root tasks survived.
// Formatting the repo exposed it a second way: Prettier's committed
// trailingComma:"all" emits `},`, which JSON.parse rejects outright.
//
// Neither is fixable with a better pattern, because `//` inside a string is data
// and only a parser knows the difference. read-jsonc.ts uses TypeScript's own
// JSONC parser -- the one tsconfig.json is read with -- and is shared by the four
// guards that each had their own copy.
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTurboTasks } from '@fleet/test-fixtures';

const here = dirname(fileURLToPath(import.meta.url));
const TURBO = resolve(here, '..', 'turbo.jsonc');

describe('__ci_fast__ covers the root scripts test suite', () => {
  // Vacuity guard FIRST, and it now asserts the ROOT TASKS specifically. The
  // previous version only checked the table was non-empty, which the broken
  // stripper satisfied while having eaten every //# entry.
  it('turbo.jsonc parses with its root tasks intact (guard is not vacuous)', () => {
    const tasks = readTurboTasks(TURBO);
    expect(Object.keys(tasks).length).toBeGreaterThan(10);
    expect(Object.keys(tasks).filter((n) => n.startsWith('//#')).length).toBeGreaterThan(10);
    expect(tasks['__ci_fast__']).toBeDefined();
  });

  it('a //#test:scripts root task is registered', () => {
    expect(readTurboTasks(TURBO)['//#test:scripts']).toBeDefined();
  });

  it('__ci_fast__ dependsOn includes //#test:scripts', () => {
    const deps = readTurboTasks(TURBO)['__ci_fast__']?.dependsOn ?? [];
    expect(deps).toContain('//#test:scripts');
  });

  it('the pre-existing gate members are still present (no accidental drop)', () => {
    const deps = readTurboTasks(TURBO)['__ci_fast__']?.dependsOn ?? [];
    for (const member of ['lint', 'typecheck', 'test:unit', '//#codemod:check']) {
      expect(deps).toContain(member);
    }
  });
});
