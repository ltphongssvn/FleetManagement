// scripts/secrets-baseline-tty.test.ts
// THE BRANCH THAT HUNG FOR EIGHT HOURS, made reachable.
//
// WHAT HAPPENED, 2026-08-18. `turbo run secrets:baseline -- --audit` blocked
// for 8h5m before it was killed. detect-secrets audit is an interactive TUI
// that prints a finding and waits on stdin for (y)es/(n)o/(s)kip/(q)uit. Turbo
// CAPTURES its child's stdio to prefix output with the task name, so the
// spawn's `stdio: 'inherit'` inherited a PIPE rather than a terminal: the
// prompt was buffered, and the child waited on a keystroke that could never
// arrive. No timeout, no diagnostic, no exit code -- just silence, and the
// task's own success message had told the operator to run that command.
//
// WHY NO TEST CAUGHT IT. There was no branch to test. main() spawned the audit
// unconditionally, and main() is under a v8-ignore because it is the
// side-effecting entrypoint. The decision "can this mode run here" did not
// exist as a value anywhere, so nothing could assert it.
//
// So the fix extracted auditNeedsTty as a PURE function taking the TTY fact as
// a PARAMETER rather than reading process.stdin. That is what makes the hang
// reachable from a unit test without a terminal, a subprocess, or a mock -- and
// it is the same shape as every other planner in this file's sibling: the
// decision is data, the I/O is the shell around it.
//
// THE CASE THAT MATTERS MOST is scan-without-a-TTY. A guard written as "no TTY
// means refuse" would read as careful and would break every CI run of the SCAN
// mode, which is non-interactive by design and is what the pre-commit hook and
// the merge gate depend on. That would trade an eight-hour hang for a broken
// pipeline: the treadmill, not a fix. It is asserted below.
import { describe, it, expect } from 'vitest';
import { auditNeedsTty, selectMode, type BaselineMode } from './secrets-baseline.js';

describe('auditNeedsTty: only the interactive mode needs a terminal', () => {
  // THE OBSERVED FAILURE, as an assertion.
  it('REFUSES an audit when stdin is not a terminal', () => {
    expect(auditNeedsTty('audit', false)).toBe(true);
  });

  it('permits an audit when stdin IS a terminal', () => {
    expect(auditNeedsTty('audit', true)).toBe(false);
  });

  // THE REGRESSION A CARELESS GUARD WOULD CAUSE. scan is non-interactive by
  // design: it is what the pre-commit hook and CI run, always without a TTY.
  // Refusing here would break every pipeline that refreshes the baseline.
  it('permits a SCAN without a terminal, which is the CI case', () => {
    expect(auditNeedsTty('scan', false)).toBe(false);
  });

  it('permits a scan with a terminal, which is the local case', () => {
    expect(auditNeedsTty('scan', true)).toBe(false);
  });

  // Stated as a property over the whole input space rather than four examples,
  // so a third mode added later cannot quietly acquire the audit's constraint.
  it('gates on the mode AND the terminal together, never on either alone', () => {
    const modes: readonly BaselineMode[] = ['scan', 'audit'];
    for (const mode of modes) {
      for (const tty of [true, false]) {
        expect([mode, tty, auditNeedsTty(mode, tty)])
          .toEqual([mode, tty, mode === 'audit' && !tty]);
      }
    }
  });
});

// The guard is only correct if the mode reaching it is the mode the operator
// asked for. selectMode is what maps argv to that, and pnpm forwards a literal
// -- as argv[0], which is the defect class this repo already fixed once in
// gate-integration.ts.
describe('selectMode feeds the guard the mode the operator actually asked for', () => {
  it('reads --audit as the audit mode', () => {
    expect(selectMode(['--audit'])).toBe('audit');
  });

  // pnpm run secrets:baseline -- --audit forwards BOTH tokens.
  it('reads --audit even when pnpm forwards a bare -- ahead of it', () => {
    expect(selectMode(['--', '--audit'])).toBe('audit');
  });

  it('defaults to scan with no arguments', () => {
    expect(selectMode([])).toBe('scan');
  });

  it('defaults to scan for an unrelated flag', () => {
    expect(selectMode(['--verbose'])).toBe('scan');
  });

  // The end-to-end property the two functions exist to provide together: the
  // exact invocation that hung is now refused rather than run.
  it('the invocation that hung -- --audit with no TTY -- is refused', () => {
    expect(auditNeedsTty(selectMode(['--', '--audit']), false)).toBe(true);
  });

  // And the invocation that works is not refused, so the fix does not simply
  // disable the feature.
  it('the invocation that works -- --audit with a TTY -- is permitted', () => {
    expect(auditNeedsTty(selectMode(['--audit']), true)).toBe(false);
  });
});
