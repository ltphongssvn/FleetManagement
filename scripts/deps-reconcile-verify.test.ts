// scripts/deps-reconcile-verify.test.ts
// RED: a heal is not reconciled until the tree is RE-READ and reports deps-ok.
//
// THE DEFECT, measured three times in one session. runReconcile derived its
// verdict from the install's exit code alone:
//
//   if (exitCode === 0) return { kind: 'reconciled', source: 'exit-zero' };
//
// pnpm exits 0 having pruned the stale tree without completing the swap, so
// deps:reconcile printed "reconciled" for a worktree whose node_modules no
// longer had a runnable turbo. The very next command failed with
// Command "turbo" not found, and the manual remedy -- a second frozen install
// -- had to be re-applied by hand in t70, t63 and t85. A verdict that is wrong
// in the operator's favour is worse than no verdict: it ends the investigation.
//
// THIS IS A KNOWN CLASS IN THIS REPO. stack:stop states the rule in its own
// description: the verdict comes from RE-READING the projects after stopping,
// never from the stop commands' exit codes. docker:reclaim repeats it. The
// reconciler was written before that lesson and never revisited.
//
// 2026 REMEDIATION PRACTICE IS THE SAME SHAPE. The canonical loop is
// detect -> remediate -> DETECT AGAIN: Intune re-runs its detection script
// after remediation, Ansible asserts the second run reports changed == false,
// and idempotency guidance states the test plainly -- run it twice and diff the
// system state; the second run must report no change. deps:reconcile performed
// detect -> remediate -> trust the exit code. The final detect was missing.
//
// NOTHING NEW IS INVENTED HERE. interpretDepsProbe is the detector the sweep
// already uses BEFORE healing, and buildProbeEnv forces
// verifyDepsBeforeRun=error so its answer is authoritative rather than a
// downgraded warn. Verifying after simply runs the same detector a second time
// through the SAME injected seam.
import { describe, it, expect } from 'vitest';
import {
  runReconcile,
  type ReconcileTarget,
  type SpawnFn,
  type SpawnOutcome,
} from './deps-reconcile-runner.js';
import { RECONCILE_EXIT } from './deps-reconcile.js';

const STALE: ReconcileTarget = {
  path: '/wt/stale',
  probe: { kind: 'deps-stale', reason: 'lockfile newer than the tree' },
};
const OK: ReconcileTarget = { path: '/wt/ok', probe: { kind: 'deps-ok' } };

interface Call {
  readonly cwd: string;
  readonly args: readonly string[];
}

// Records every spawn, and answers each one from a scripted queue so a test can
// say "the heal exits 0, then the verify still reports stale" -- the exact
// shape of the real defect.
function recorder(outcomes: readonly SpawnOutcome[]): {
  spawn: SpawnFn;
  calls: Call[];
} {
  const calls: Call[] = [];
  let i = 0;
  const spawn: SpawnFn = (cwd, args) => {
    calls.push({ cwd, args: [...args] });
    const next = outcomes[i] ?? { status: 0, stdout: '', stderr: '' };
    i += 1;
    return next;
  };
  return { spawn, calls };
}

const HEALED: SpawnOutcome = { status: 0, stdout: '', stderr: '' };
const VERIFY_OK: SpawnOutcome = { status: 0, stdout: '', stderr: '' };
const VERIFY_STALE: SpawnOutcome = {
  status: 1,
  stdout: '',
  stderr: '[ERR_PNPM_VERIFY_DEPS_BEFORE_RUN] tree is out of sync',
};

describe('runReconcile verifies by RE-READING, never by exit code', () => {
  it('spawns a SECOND time to re-probe after a heal that exited 0', () => {
    const { spawn, calls } = recorder([HEALED, VERIFY_OK]);
    runReconcile([STALE], spawn, { execute: true });
    expect(
      calls.length,
      'an exit code is not evidence the tree converged; the sweep must look again',
    ).toBe(2);
    expect(calls.every((c) => c.cwd === '/wt/stale')).toBe(true);
  });

  it('reports reconciled ONLY when the re-probe says deps-ok', () => {
    const { spawn } = recorder([HEALED, VERIFY_OK]);
    const r = runReconcile([STALE], spawn, { execute: true });
    expect(r.summary.reconciled).toBe(1);
    expect(r.summary.failed).toBe(0);
    expect(r.exitCode).toBe(RECONCILE_EXIT.ok);
  });

  it('REFUSES to report reconciled when the heal exits 0 but the tree is still stale', () => {
    // THE REGRESSION. This is the run that printed "reconciled" while turbo was
    // missing, three times in one session.
    const { spawn } = recorder([HEALED, VERIFY_STALE]);
    const r = runReconcile([STALE], spawn, { execute: true });
    expect(
      r.summary.reconciled,
      'a heal that leaves the tree unusable is not a reconciliation',
    ).toBe(0);
    expect(r.summary.failed).toBe(1);
    expect(r.exitCode).toBe(RECONCILE_EXIT.failed);
  });

  it('names the still-stale worktree in the report so it is actionable', () => {
    const { spawn } = recorder([HEALED, VERIFY_STALE]);
    const r = runReconcile([STALE], spawn, { execute: true });
    const text = r.lines.join(' ');
    expect(text).toContain('/wt/stale');
    expect(text.toLowerCase()).toContain('still');
  });

  it('does NOT re-probe when the heal itself failed -- there is nothing to verify', () => {
    const FAILED_HEAL: SpawnOutcome = {
      status: 1,
      stdout: '',
      stderr: '[ERROR] ERR_PNPM_OUTDATED_LOCKFILE lockfile disagrees',
    };
    const { spawn, calls } = recorder([FAILED_HEAL]);
    const r = runReconcile([STALE], spawn, { execute: true });
    expect(calls.length).toBe(1);
    expect(r.summary.divergent).toBe(1);
  });

  it('still spawns NOTHING in a dry run', () => {
    const { spawn, calls } = recorder([HEALED, VERIFY_OK]);
    const r = runReconcile([STALE], spawn, { execute: false });
    expect(calls.length).toBe(0);
    expect(r.planned).toBe(1);
  });

  it('never spawns for an already-ok worktree', () => {
    const { spawn, calls } = recorder([HEALED, VERIFY_OK]);
    const r = runReconcile([OK], spawn, { execute: true });
    expect(calls.length).toBe(0);
    expect(r.summary.skipped).toBe(1);
  });

  it('isolates per target: one still-stale worktree does not stop the sweep', () => {
    const OTHER: ReconcileTarget = {
      path: '/wt/other',
      probe: { kind: 'deps-stale', reason: 'stale too' },
    };
    const { spawn, calls } = recorder([HEALED, VERIFY_STALE, HEALED, VERIFY_OK]);
    const r = runReconcile([STALE, OTHER], spawn, { execute: true });
    expect(calls.some((c) => c.cwd === '/wt/other')).toBe(true);
    expect(r.summary.failed).toBe(1);
    expect(r.summary.reconciled).toBe(1);
  });
});
