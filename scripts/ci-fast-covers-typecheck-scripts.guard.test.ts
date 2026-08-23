// scripts/ci-fast-covers-typecheck-scripts.guard.test.ts
// Guard: //#typecheck:scripts must stay wired into the __ci_fast__ PR gate.
//
// WHY IT EXISTS. Nothing typechecked scripts/: the package-scoped typecheck task
// cannot reach a tree that belongs to no workspace package, and //#lint:scripts
// is type-aware but reports lint rules only -- it builds a TS program and never
// surfaces the general diagnostic set. A noUncheckedIndexedAccess violation
// passed lint while returning undefined at runtime, and that hole produced a
// FALSE MERGE: an unclassifiable check was dropped from every bucket and the
// rollup reported green.
//
// PARSING (2026-08-23). This guard carried its own JSONC reader -- strip every
// line whose first token is //, then JSON.parse -- which deleted all 47 root
// task definitions before parsing, including the //#typecheck:scripts entry this
// file exists to assert. It passed anyway, because nothing checked the root
// tasks survived the strip. Prettier's committed trailingComma:"all" then broke
// it outright, since JSON.parse rejects `},`.
//
// A better regex cannot fix it: `//` inside a string is data, and only a parser
// knows the difference. read-jsonc.ts uses TypeScript's own JSONC parser -- the
// one tsconfig.json is read with -- shared across the four guards that each kept
// a copy.
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTurboTasks } from '@fleet/test-fixtures';

const here = dirname(fileURLToPath(import.meta.url));
const TURBO = resolve(here, '..', 'turbo.jsonc');

describe('__ci_fast__ covers the root scripts typecheck', () => {
  // Vacuity guard FIRST, asserting the ROOT TASKS specifically -- the previous
  // version only required a non-empty table, which the broken stripper met
  // while having eaten every //# entry.
  it('turbo.jsonc parses with its root tasks intact (guard is not vacuous)', () => {
    const tasks = readTurboTasks(TURBO);
    expect(Object.keys(tasks).length).toBeGreaterThan(10);
    expect(Object.keys(tasks).filter((n) => n.startsWith('//#')).length).toBeGreaterThan(10);
    expect(tasks['__ci_fast__']).toBeDefined();
  });

  it('a //#typecheck:scripts root task is registered', () => {
    expect(readTurboTasks(TURBO)['//#typecheck:scripts']).toBeDefined();
  });

  it('__ci_fast__ dependsOn includes //#typecheck:scripts', () => {
    const deps = readTurboTasks(TURBO)['__ci_fast__']?.dependsOn ?? [];
    expect(deps).toContain('//#typecheck:scripts');
  });

  // The triad is gated together on purpose: lint, typecheck and test over
  // scripts/ each close a different hole, and gating two of three leaves the
  // third silently unrun.
  it('the root-tooling triad is gated together', () => {
    const deps = readTurboTasks(TURBO)['__ci_fast__']?.dependsOn ?? [];
    for (const member of ['//#lint:scripts', '//#typecheck:scripts', '//#test:scripts']) {
      expect(deps).toContain(member);
    }
  });

  it('the pre-existing gate members are still present (no accidental drop)', () => {
    const deps = readTurboTasks(TURBO)['__ci_fast__']?.dependsOn ?? [];
    for (const member of ['lint', 'typecheck', 'test:unit', '//#codemod:check']) {
      expect(deps).toContain(member);
    }
  });

  // The task was ungated at registration while 89 pre-existing errors were
  // burned down; the description said so. It reached zero and the gate went
  // live, so a description still claiming it is ungated would now be a lie that
  // outlives the condition it described.
  it('the task description no longer claims it is ungated', () => {
    const description = readTurboTasks(TURBO)['//#typecheck:scripts']?.description ?? '';
    expect(description.length).toBeGreaterThan(0);
    expect(description).toContain('WIRED INTO __ci_fast__');
  });
});
