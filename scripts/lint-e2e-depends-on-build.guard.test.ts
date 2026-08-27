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
//
// PARSING (2026-08-23). This file read turbo.jsonc by blanking every line
// matching /^\s*\/\/.*$/gm and calling JSON.parse. That regex deletes the line
// `"//#lint:e2e": {` -- the exact task this guard exists to assert -- along with
// all 47 other root-task definitions, because a turbo root task is spelled with
// the same two characters as a line comment. Prettier's committed
// trailingComma:"all" then broke it outright, since JSON.parse rejects `},`.
//
// The property is not lexical, so no pattern fixes it: `//` inside a string is
// data. read-jsonc.ts uses TypeScript's own JSONC parser -- the one
// tsconfig.json is read with -- and is shared by the guards that each kept a
// private copy of this bug.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readTurboTasks } from '@fleet/test-fixtures';

const TURBO = join(import.meta.dirname, '..', 'turbo.jsonc');
const tasks = readTurboTasks(TURBO);

const dependsOn = (task: string): readonly string[] => tasks[task]?.dependsOn ?? [];

describe('type-aware lint tasks depend on upstream builds', () => {
  // Vacuity guard FIRST. The old reader silently removed every //# task, and
  // nothing noticed -- so the subject of every assertion below is checked to
  // exist before anything is asserted about it.
  it('turbo.jsonc parses with its root tasks intact', () => {
    expect(Object.keys(tasks).filter((n) => n.startsWith('//#')).length).toBeGreaterThan(10);
    expect(tasks['//#lint:e2e']).toBeDefined();
  });

  it.each(['//#lint:e2e', 'lint', 'typecheck'])('%s declares ^build', (task) => {
    expect(dependsOn(task)).toContain('^build');
  });

  it('lint:e2e records WHY it needs ^build, not just THAT it does', () => {
    const description = tasks['//#lint:e2e']?.description;
    expect(typeof description).toBe('string');
    expect(description).toMatch(/emitted \.d\.ts/i);
  });

  it('lint:e2e is still wired into the PR gate', () => {
    expect(dependsOn('__ci_fast__')).toContain('//#lint:e2e');
  });

  // THE SAME CONSTRAINT, ONE DIRECTORY OVER, and it bit exactly as predicted.
  //
  // Four guards under scripts/ import readTurboTasks from @fleet/test-fixtures,
  // whose exports point at ./dist/index.js. //#test:scripts got the edge on
  // 2026-08-23; its two siblings -- which LINT and TYPECHECK those very same
  // files -- did not. They passed on every warm worktree for a day and failed
  // on the first COLD one with 18 no-unsafe-argument / dot-notation reports
  // that named neither the package nor the missing build, because an
  // unresolvable import types readTurboTasks as an ERROR type and every call
  // downstream degrades.
  //
  // A ROOT task has no package dependencies, so ^build (asserted above for the
  // package tasks) cannot express this; the edge must name the package task.
  // Asserted as a SET so fixing one sibling and leaving the others -- the exact
  // shape of the original defect -- fails here.
  it.each(['//#lint:scripts', '//#typecheck:scripts', '//#test:scripts'])(
    '%s depends on the built @fleet/test-fixtures it imports',
    (task) => {
      expect(
        dependsOn(task),
        task +
          ' imports readTurboTasks from @fleet/test-fixtures, which resolves ' +
          'through dist/. Without this edge the task runs before the build and ' +
          'fails only on a cold checkout.',
      ).toContain('@fleet/test-fixtures#build');
    },
  );

  it('the scripts trio records WHY the edge exists', () => {
    for (const task of ['//#lint:scripts', '//#typecheck:scripts', '//#test:scripts']) {
      const description = tasks[task]?.description ?? '';
      expect(description, task + ' must explain the dist-resolution reason').toMatch(
        /@fleet\/test-fixtures#build/,
      );
    }
  });
});
