// apps/api/test/pg-global-setup-no-reuse-orphan-guard.test.ts
// Regression guard (root-cause fix 2026-07-08): the single-shared-container
// globalSetup must NOT call .withReuse(). Under the full-workspace pnpm -r
// coverage gate, runs can abort before global-teardown.ts removes the
// container. With Ryuk deliberately disabled AND reuse requested but NOT
// enabled in the environment (no TESTCONTAINERS_REUSE_ENABLE), .withReuse()
// produced an orphan container with an empty reuse-hash and an UNPUBLISHED
// host port. The next run then waited on inspectContainerUntilPortsExposed
// until the startup timeout and failed with Timed out waiting for container
// ports to be bound.
//
// Per-worktree isolation is already guaranteed structurally by .withName()
// plus .withLabels() (worktree-container-identity.ts), so .withReuse() adds no
// isolation -- only the orphan failure mode. This guard asserts the anti-
// pattern stays removed and that an explicit generous startup timeout is set.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const setupSrc = readFileSync(resolve(here, 'helpers/pg-global-setup.ts'), 'utf8');
const NL = String.fromCharCode(10);
const SLASH = String.fromCharCode(47);
const LINE_COMMENT = SLASH + SLASH;
// Code-only view: drop line-comment lines so assertions about CALLS are not
// tripped by comments that merely MENTION an API (e.g. a note explaining the
// .withReuse() removal). A line is a comment when its trimmed form starts with
// a double slash.
const isCommentLine = (line: string): boolean => line.trimStart().startsWith(LINE_COMMENT);
const codeOnly = setupSrc
  .split(NL)
  .filter((line) => !isCommentLine(line))
  .join(NL);
const SQ = String.fromCharCode(39);
const RYUK_ASSIGN = 'TESTCONTAINERS_RYUK_DISABLED' + SQ + '] = ' + SQ + 'true' + SQ;

describe('pg-global-setup orphan-container regression guard', () => {
  it('does NOT call .withReuse() in code (reuse plus disabled-Ryuk plus reuse-not-enabled = port-less orphan)', () => {
    expect(codeOnly.includes('.withReuse(')).toBe(false);
  });

  it('sets an explicit generous startup timeout for full-workspace load', () => {
    expect(codeOnly.includes('.withStartupTimeout(')).toBe(true);
  });

  it('keeps Ryuk disabled (label-scoped global-teardown is the single cleanup path)', () => {
    expect(codeOnly.includes(RYUK_ASSIGN)).toBe(true);
  });

  it('retains per-worktree container identity (name plus label) for isolation', () => {
    expect(codeOnly.includes('.withName(')).toBe(true);
    expect(codeOnly.includes('.withLabels(')).toBe(true);
  });
});
