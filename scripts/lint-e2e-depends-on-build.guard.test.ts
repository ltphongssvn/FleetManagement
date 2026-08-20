// scripts/lint-e2e-depends-on-build.guard.test.ts
// //#lint:e2e is TYPE-AWARE: eslint.config.mjs binds e2e/**/*.ts to
// e2e/tsconfig.json, and e2e/helpers/wait-for-projection.ts imports
// DispatchBoardResponseSchema from @fleet/sync-protocol. Those imports resolve
// through the package's EMITTED .d.ts, never its source, so without a built
// dist/ they resolve to `any` and every no-unsafe-* rule fires.
//
// The task shipped with NO dependsOn at all and had only ever passed by
// relying on a warm dist/ left by an earlier run. Observed 2026-08-20: five
// no-unsafe-* errors on a file nobody had touched, immediately after a
// sync-protocol source edit staled the build -- and a clean CI checkout would
// have failed the same way for the life of the task.
//
// lint (dependsOn ^build) and typecheck (dependsOn ^build) both document this
// exact constraint in their own descriptions. This guard keeps the third
// root-scoped sibling from drifting back out of that contract.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..');

/** turbo.jsonc allows comments; strip whole-line // before parsing. */
const readTurboConfig = (): Record<string, unknown> => {
  const raw = readFileSync(join(REPO_ROOT, 'turbo.jsonc'), 'utf8');
  return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, '')) as Record<string, unknown>;
};

const tasks = readTurboConfig()['tasks'] as Record<string, Record<string, unknown>>;

const dependsOn = (task: string): string[] =>
  (tasks[task]?.['dependsOn'] as string[] | undefined) ?? [];

describe('type-aware lint tasks depend on upstream builds', () => {
  it.each(['//#lint:e2e', 'lint', 'typecheck'])(
    '%s declares ^build',
    (task) => {
      expect(dependsOn(task)).toContain('^build');
    },
  );

  it('lint:e2e records WHY it needs ^build, not just THAT it does', () => {
    const description = tasks['//#lint:e2e']?.['description'];
    expect(typeof description).toBe('string');
    expect(description).toMatch(/emitted \.d\.ts/i);
  });

  it('lint:e2e is still wired into the PR gate', () => {
    expect(dependsOn('__ci_fast__')).toContain('//#lint:e2e');
  });
});
