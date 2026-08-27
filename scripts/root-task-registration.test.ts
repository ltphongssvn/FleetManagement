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
// This also closes a divergence created in an earlier session: a splice wrote
// the package.json entry, the turbo.jsonc write failed, and the two registries
// disagreed silently -- one invocation worked, the other did not.
//
// The REVERSE is deliberately not asserted. A root script with no node is
// often correct: build:fresh and verify:ci delegate to `turbo run`, and
// knip:files is a flag variant of //#knip. Asserting it would flag correct
// code, and a guard that cries wolf gets ignored.
//
// PARSING (2026-08-23), and this file is the sharpest instance of the bug. It
// blanked every line whose first token is // before parsing, then filtered the
// result for names STARTING WITH //# -- deleting exactly the keys it went on to
// look for. rootTaskNames() returned an empty array, so the orphan check ran
// over nothing and passed vacuously for the life of the guard. The
// "finds root tasks to check" assertion above was written to catch precisely
// this, and it never fired, because an empty list and a clean list are the same
// shape once the subject is gone -- it only surfaced when Prettier's committed
// trailingComma:"all" made JSON.parse throw instead of silently succeeding.
//
// No pattern fixes it: `//` inside a string is data, and only a parser knows
// the difference. read-jsonc.ts uses TypeScript's own JSONC parser -- the one
// tsconfig.json is read with -- and throws on an empty task table rather than
// handing back the empty object that made this vacuous.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readTurboTasks } from '@fleet/test-fixtures';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TURBO = resolve(root, 'turbo.jsonc');

function rootScripts(): ReadonlySet<string> {
  const raw: unknown = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const scripts =
    typeof raw === 'object' && raw !== null && 'scripts' in raw
      ? (raw as { scripts: Record<string, string> }).scripts
      : {};
  return new Set(Object.keys(scripts));
}

/** Root task names with the //# prefix removed -- the package.json script name
 *  turbo actually invokes. */
function rootTaskNames(): readonly string[] {
  return Object.keys(readTurboTasks(TURBO))
    .filter((name) => name.startsWith('//#'))
    .map((name) => name.slice(3));
}

describe('root task registration', () => {
  // Vacuity guard FIRST, and now with a REAL floor rather than > 0. The old
  // version accepted any non-negative count, which an empty list satisfies the
  // moment it is non-empty by accident; this repo has dozens of root tasks, so
  // a handful means the reader is broken.
  it('finds root tasks to check, so the assertions have a subject', () => {
    expect(rootTaskNames().length).toBeGreaterThan(20);
  });

  it('every root task has the package.json script turbo invokes', () => {
    const scripts = rootScripts();
    const orphans = rootTaskNames().filter((name) => !scripts.has(name));
    expect(orphans).toEqual([]);
  });
});
