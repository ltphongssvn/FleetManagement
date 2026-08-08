// scripts/ci-fast-covers-typecheck-scripts.guard.test.ts
// Guard (root-cause fix): //#typecheck:scripts -- tsc --noEmit over the
// repo-level tooling in scripts/ -- must run inside the __ci_fast__ PR gate.
//
// WHY THIS REPLACES A RATCHET. The task was registered in d1f53f2 with 58
// pre-existing errors and deliberately left OUT of the gate: wiring it while
// red would have made every branch in a ~50-worktree estate unmergeable at once
// and taught everyone to ignore the tool (the same adoption reasoning //#knip
// documents). scripts/typecheck-scripts-ratchet.guard.test.ts held the line in
// the meantime -- errors may fall, never rise -- and its own header states the
// exit condition verbatim: "When it reaches 0, delete this guard and add
// //#typecheck:scripts to __ci_fast__ in turbo.jsonc". The count reached 0, so
// the ratchet is deleted and this guard takes its place.
//
// The ratchet also FAILED at zero, and correctly: tsc prints nothing on
// success, so its "an unreadable run is NOT zero errors; a confident zero would
// silently retire the ratchet" check could not distinguish success from a
// crashed run. Patching it to tolerate silence would have kept burn-down
// scaffolding alive past the burn-down while leaving the task ungated -- the
// "check exists in principle and nowhere in practice" hole the task
// description itself warns about. Promotion is the real fix.
//
// WHAT THIS ASSERTS, and why it is not the same as the check running: the gate
// executes the typecheck; this guard asserts the WIRING, so a future edit that
// drops //#typecheck:scripts from __ci_fast__ fails here rather than silently
// reopening the hole -- exactly the shape of the sibling
// ci-fast-covers-test-scripts.guard.test.ts, which is the precedent the ratchet
// named for this step.
//
// Lives under scripts/ on purpose so vitest run scripts executes it: the suite
// that runs this guard is the same one the gate it protects invokes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const NLc = String.fromCharCode(10);
const SLASH = String.fromCharCode(47);
const LINE_COMMENT = SLASH + SLASH;

// JSONC -> JSON: drop whole-line // comments (turbo.jsonc uses only line
// comments, never block or trailing), then parse. A trailing-comment strip
// would corrupt the // inside task names like //#typecheck:scripts, so only
// lines whose first non-space token is the comment marker are dropped.
function readTurboTasks(): Record<string, { dependsOn?: string[]; description?: string }> {
  const raw = readFileSync(resolve(repoRoot, 'turbo.jsonc'), 'utf8');
  const jsonOnly = raw
    .split(NLc)
    .filter((line) => !line.trimStart().startsWith(LINE_COMMENT))
    .join(NLc);
  const parsed = JSON.parse(jsonOnly) as {
    tasks: Record<string, { dependsOn?: string[]; description?: string }>;
  };
  return parsed.tasks;
}

describe('__ci_fast__ covers the root scripts typecheck', () => {
  it('turbo.jsonc parses after stripping line comments (guard is not vacuous)', () => {
    const tasks = readTurboTasks();
    expect(Object.keys(tasks).length).toBeGreaterThan(10);
    expect(tasks['__ci_fast__']).toBeDefined();
  });

  it('a //#typecheck:scripts root task is registered', () => {
    expect(readTurboTasks()['//#typecheck:scripts']).toBeDefined();
  });

  it('__ci_fast__ dependsOn includes //#typecheck:scripts', () => {
    const deps = readTurboTasks()['__ci_fast__']?.dependsOn ?? [];
    expect(
      deps,
      'a scripts/ type error must fail the PR gate; without this the task exists ' +
        'but nothing invokes it, which is the hole the ratchet was holding open',
    ).toContain('//#typecheck:scripts');
  });

  it('the root-tooling triad is gated together', () => {
    const deps = readTurboTasks()['__ci_fast__']?.dependsOn ?? [];
    for (const member of ['//#lint:scripts', '//#test:scripts', '//#typecheck:scripts']) {
      expect(deps, member + ' completes the lint+test+typecheck triad for scripts/').toContain(member);
    }
  });

  it('the pre-existing gate members are still present (no accidental drop)', () => {
    const deps = readTurboTasks()['__ci_fast__']?.dependsOn ?? [];
    for (const member of ['lint', 'typecheck', 'test:unit', '//#codemod:check']) {
      expect(deps).toContain(member);
    }
  });

  it('the task description no longer claims it is ungated', () => {
    const desc = readTurboTasks()['//#typecheck:scripts']?.description ?? '';
    expect(
      desc,
      'the description documented the burn-down plan ("NOT wired into __ci_fast__ ' +
        'yet ... burn the count down, then promote it to a gate"); leaving that text ' +
        'in place after promotion would misdescribe the gate to the next reader',
    ).not.toContain('NOT wired into __ci_fast__');
  });
});
