// scripts/root-task-registration.test.ts
// Every //# root task in turbo.jsonc must have a matching root package.json
// script, because turbo runs root tasks BY invoking that script. A node
// without one is dead: `turbo run <name>` fails at the point of use, and
// nothing else in the repo notices.
//
// Found live: //#graph is registered with a full description and no `graph`
// script exists, so the documented invocation in its own description cannot
// work. Dead since it was written.
//
// This also closes the divergence I created during this session: a splice
// wrote the package.json entry, the turbo.jsonc write failed, and the two
// registries disagreed silently -- one invocation worked, the other did not,
// and only trying the failing one would have revealed it.
//
// The REVERSE is deliberately not asserted. A root script with no node is
// often correct: build:fresh and verify:ci delegate to `turbo run`, and
// knip:files is a flag variant of //#knip. Asserting it would flag correct
// code, and a guard that cries wolf gets ignored.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
const NL = String.fromCharCode(10);
const SLASH = String.fromCharCode(47);
const LINE_COMMENT = SLASH + SLASH;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function rootScripts(): ReadonlySet<string> {
  const raw: unknown = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const scripts =
    typeof raw === 'object' && raw !== null && 'scripts' in raw
      ? (raw as { scripts: Record<string, string> }).scripts
      : {};
  return new Set(Object.keys(scripts));
}
// turbo.jsonc carries // comments, so strip comment LINES before parsing --
// the same code-only convention pg-global-setup-no-reuse-orphan-guard uses.
// Parsing beats regex here: a task name inside a description string must not
// be mistaken for a node key.
function rootTaskNames(): readonly string[] {
  const text = readFileSync(resolve(root, 'turbo.jsonc'), 'utf8')
    .split(NL)
    .map((line) => (line.trimStart().startsWith(LINE_COMMENT) ? '' : line))
    .join(NL);
  const parsed: unknown = JSON.parse(text);
  const tasks =
    typeof parsed === 'object' && parsed !== null && 'tasks' in parsed
      ? (parsed as { tasks: Record<string, unknown> }).tasks
      : {};
  return Object.keys(tasks)
    .filter((name) => name.startsWith('//#'))
    .map((name) => name.slice(3));
}
describe('root task registration', () => {
  it('finds root tasks to check, so the assertions have a subject', () => {
    expect(rootTaskNames().length).toBeGreaterThan(0);
  });
  it('every root task has the package.json script turbo invokes', () => {
    const scripts = rootScripts();
    const orphans = rootTaskNames().filter((name) => !scripts.has(name));
    expect(orphans).toEqual([]);
  });
});
// RTR_EOF_SENTINEL_END
