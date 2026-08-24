// scripts/format-gate-wired.guard.test.ts
// Guard: //#format:check must stay inside the __ci_fast__ PR gate.
//
// WHY THIS EXISTS. Prettier, eslint-config-prettier and .prettierrc were all
// committed to this repo and NOTHING RAN THE FORMATTER: 1202 files were
// unformatted when the burndown started. Driving that to zero buys nothing if
// the next commit can reopen it -- a formatter with no gate is a preference,
// not a standard.
//
// This is the SEVENTH instance of the decorative-control shape in this repo,
// after //#lint:scripts, //#typecheck:scripts, //#lint:e2e, //#estate:verify,
// //#worktree:stale-gate and //#test:scripts: a task real in principle and
// unenforced in practice. Each was closed by wiring it into the aggregate AND
// asserting the wiring, because the wiring is the part that silently
// disappears in a future edit.
//
// Reads turbo.jsonc through the shared TypeScript JSONC parser. A hand-rolled
// reader that strips // lines deletes every //# root task -- including the one
// this file asserts -- and passes vacuously; that defect was found in five
// separate copies during the burndown.
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTurboTasks } from '@fleet/test-fixtures';

const here = dirname(fileURLToPath(import.meta.url));
const TURBO = resolve(here, '..', 'turbo.jsonc');

describe('__ci_fast__ enforces repository formatting', () => {
  // Vacuity guard FIRST: an empty or root-task-stripped table would make every
  // assertion below meaningless in the direction that passes.
  it('turbo.jsonc parses with its root tasks intact', () => {
    const tasks = readTurboTasks(TURBO);
    expect(Object.keys(tasks).filter((n) => n.startsWith('//#')).length).toBeGreaterThan(10);
    expect(tasks['__ci_fast__']).toBeDefined();
  });

  it('a //#format:check root task is registered', () => {
    expect(readTurboTasks(TURBO)['//#format:check']).toBeDefined();
  });

  it('__ci_fast__ dependsOn includes //#format:check', () => {
    const deps = readTurboTasks(TURBO)['__ci_fast__']?.dependsOn ?? [];
    expect(deps).toContain('//#format:check');
  });

  // The other root-scoped repo-wide checks, asserted together: they close the
  // same class of hole and drop out the same way.
  it('the repo-wide root checks are gated as a set', () => {
    const deps = readTurboTasks(TURBO)['__ci_fast__']?.dependsOn ?? [];
    for (const member of [
      '//#format:check',
      '//#lint:scripts',
      '//#typecheck:scripts',
      '//#test:scripts',
      '//#lint:e2e',
      '//#guard:local-secrets',
    ]) {
      expect(deps).toContain(member);
    }
  });

  // The description is where this repo records WHY a task is gated, and the
  // not-born-red check is the fact a future reader most needs: it explains why
  // gating this was safe on the day it happened.
  it('the task description records the wiring and the not-born-red check', () => {
    const description = readTurboTasks(TURBO)['//#format:check']?.description ?? '';
    expect(description).toContain('WIRED INTO __ci_fast__');
    expect(description).toContain('NOT BORN RED');
  });
});
