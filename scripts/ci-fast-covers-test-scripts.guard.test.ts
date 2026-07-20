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
// -- the gate it protects is the same suite that runs it. It reads turbo.jsonc
// (JSONC: strips line comments before JSON.parse) and asserts the wiring, so a
// future edit that drops test:scripts from the gate fails here rather than
// silently reopening the hole.
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
// would corrupt the // inside task names like //#test:scripts, so we only
// drop lines whose first non-space token is the comment marker.
function readTurboTasks(): Record<string, { dependsOn?: string[] }> {
  const raw = readFileSync(resolve(repoRoot, 'turbo.jsonc'), 'utf8');
  const jsonOnly = raw
    .split(NLc)
    .filter((line) => !line.trimStart().startsWith(LINE_COMMENT))
    .join(NLc);
  const parsed = JSON.parse(jsonOnly) as { tasks: Record<string, { dependsOn?: string[] }> };
  return parsed.tasks;
}
describe('__ci_fast__ covers the root scripts test suite', () => {
  it('turbo.jsonc parses after stripping line comments (guard is not vacuous)', () => {
    const tasks = readTurboTasks();
    expect(Object.keys(tasks).length).toBeGreaterThan(10);
    expect(tasks['__ci_fast__']).toBeDefined();
  });
  it('a //#test:scripts root task is registered', () => {
    const tasks = readTurboTasks();
    expect(tasks['//#test:scripts']).toBeDefined();
  });
  it('__ci_fast__ dependsOn includes //#test:scripts', () => {
    const tasks = readTurboTasks();
    const deps = tasks['__ci_fast__']?.dependsOn ?? [];
    expect(deps).toContain('//#test:scripts');
  });
  it('the pre-existing gate members are still present (no accidental drop)', () => {
    const deps = readTurboTasks()['__ci_fast__']?.dependsOn ?? [];
    for (const member of ['lint', 'typecheck', 'test:unit', '//#codemod:check']) {
      expect(deps).toContain(member);
    }
  });
});
