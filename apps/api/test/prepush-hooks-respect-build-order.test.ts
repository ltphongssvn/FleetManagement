// apps/api/test/prepush-hooks-respect-build-order.test.ts
// A hook that runs a ^build-dependent task through `pnpm -r` runs it without
// ever building its upstreams, and will read stale artifacts.
//
// ROOT CAUSE THIS GUARDS. Cross-package imports of @fleet/* resolve to each
// dependency's EMITTED .d.ts in dist/, not to its source. turbo.jsonc declares
// dependsOn ["^build"] on lint and typecheck for exactly that reason, and its
// task descriptions spell out the failure: without ^build a clean run fails
// with TS2307 Cannot find module @fleet/..., and the type-aware
// @typescript-eslint/no-unsafe-* rules silently resolve those imports to any.
//
// THE PRECISE DEFECT, and it is NOT that pnpm ignores the dependency graph.
// pnpm -r DOES sort packages topologically (dependencies before dependents;
// --no-sort disables it). But topological ordering orders THE SAME TASK across
// packages -- it cannot insert a DIFFERENT task as a prerequisite. `pnpm -r
// typecheck` therefore typechecks in dependency order while building nothing.
// ^build is a CROSS-TASK edge -- "for every package this depends on, run BUILD
// first" -- and pnpm has no concept of one. Only turbo can honour it.
//
// OBSERVED. After a 73-commit sync:develop merge-down in t17, the pre-push
// lint and typecheck hooks failed in ops-web and main-worker, two packages the
// branch never touched, because both lanes read a dist/ emitted before the
// merge. Running the identical commands directly moments later was clean.
//
// WHY IT SURVIVED: the bug erases its own evidence. Hooks run
// lint -> typecheck -> BUILD VERIFICATION -> coverage. Build Verification
// rebuilds dist/ mid-run, so coverage passes and a plain retry passes too.
// Every prior encounter ended in "re-ran it, fine" -- which is why this is a
// guard and not a one-time edit.
//
// Same shape as the lesson .pre-commit-config.yaml already records for the
// coverage gate: behaviour living only in an inline bash string is untested and
// free to drift. This asserts the property instead of trusting the string.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTurboTasks } from '@fleet/test-fixtures';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel: string): string => readFileSync(resolve(repoRoot, rel), 'utf8');
const NL = String.fromCharCode(10);

/** Package tasks that declare an upstream-BUILD edge, so their inputs are other
 *  packages' emitted artifacts rather than source. Root tasks (//#) and
 *  orchestration nodes (__ci__) are excluded: they are not per-package lanes.
 *
 *  PARSING (2026-08-23). This carried its own JSONC reader -- strip every line
 *  whose first token is //, then JSON.parse -- the FIFTH copy of that bug and
 *  the only one outside scripts/. It deleted all 47 turbo root-task definitions
 *  before parsing, since a //# task name opens with the same two characters as
 *  a line comment, and this guard then filtered those names out again, hiding
 *  the damage. Prettier's committed trailingComma:"all" made JSON.parse throw
 *  and surfaced it. Now the shared @fleet/test-fixtures reader, which uses
 *  TypeScript's own JSONC parser -- imported BY PACKAGE NAME, never by a
 *  relative path across the workspace boundary. */
function tasksRequiringUpstreamBuild(): readonly string[] {
  const tasks = readTurboTasks(resolve(repoRoot, 'turbo.jsonc'));
  return Object.entries(tasks)
    .filter(([, cfg]) => (cfg.dependsOn ?? []).includes('^build'))
    .map(([name]) => name)
    .filter((name) => !name.startsWith('//#') && !name.startsWith('__'));
}

/** Does this hook entry invoke EXACTLY this task? Substring containment is
 *  not enough: the commitlint entry contains the substring "lint", and a
 *  plain includes() flagged it as running the lint task. Require a word
 *  boundary so `run lint` and `present lint` match while `commitlint` does
 *  not -- the same weak-matcher trap that bit the comment-vs-code gates. */
function invokesTask(entry: string, task: string): boolean {
  const escaped = task.replace(
    /[.*+?^${}()|[\]\\]/g,
    String.fromCharCode(92) + 'function hookEntries(): readonly string[] {',
  );
  return new RegExp('(^|[\\s])' + escaped + '([\\s;' + String.fromCharCode(39) + '\\"]|$)').test(
    entry,
  );
}
function hookEntries(): readonly string[] {
  return read('.pre-commit-config.yaml')
    .split(NL)
    .filter((l) => l.trimStart().startsWith('entry:'));
}

describe('pre-push hooks respect turbo build ordering', () => {
  it('finds at least one ^build-dependent task, so the guard is not vacuous', () => {
    expect(tasksRequiringUpstreamBuild().length).toBeGreaterThan(0);
  });

  it('never runs a ^build-dependent task through recursive pnpm', () => {
    const offenders = tasksRequiringUpstreamBuild().flatMap((task) =>
      hookEntries()
        .filter((entry) => entry.includes('pnpm -r') && invokesTask(entry, task))
        .map((entry) => task + ' <- ' + entry.trim()),
    );
    expect(offenders).toEqual([]);
  });

  // CONDITIONAL, deliberately. Not every ^build task appears in a hook --
  // test:unit declares the edge but the pre-push lane runs test:coverage
  // instead, and a task the hooks never invoke cannot be invoked wrongly. The
  // invariant is: IF a hook runs one, it runs it through turbo.
  it('invokes any such task it does run through turbo, never another runner', () => {
    const entries = hookEntries();
    const wrong: string[] = [];
    for (const task of tasksRequiringUpstreamBuild()) {
      for (const entry of entries) {
        if (!invokesTask(entry, task)) continue;
        if (entry.includes('turbo run')) continue;
        wrong.push(task + ' <- ' + entry.trim());
      }
    }
    expect(wrong).toEqual([]);
  });
});
