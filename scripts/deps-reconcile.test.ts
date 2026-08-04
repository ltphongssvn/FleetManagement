// scripts/deps-reconcile.test.ts
// RED (t82 deps-reconcile arc, 2026-08-04): pure decision cores for the
// //#deps:reconcile task -- the REMEDIATION half sync:worktrees refuses to own.
//
// WHY A SEPARATE TASK, not a --heal flag. sync-worktrees-deps-wiring.test.ts
// asserts as a standing contract that sync-worktrees.ts contains neither
// "install --force" nor "--frozen-lockfile": an implicit install across 45
// worktrees on a 9.7GiB box is destructive, and the operator decides when to
// install. That guard is CORRECT and stays unmodified. Bolting a flag onto the
// detector would have turned a green contract red and invited deleting it --
// suppressing a guard to fit a feature. Healing gets its own registered task;
// invoking it deliberately IS the operator deciding.
//
// INSTRUMENT, from pnpm's docs: --frozen-lockfile does not generate a lockfile
// and FAILS when the lockfile is out of sync with the manifest. Two properties
// follow, and the whole design rests on them:
//   1. it can never rewrite pnpm-lock.yaml, so it cannot resurrect the
//      lockfile-dirtying auto-install treadmill verifyDepsBeforeRun: warn kills;
//   2. its OUTCOME is the classifier. Exit 0 means the tree merely lagged an
//      already-correct lockfile. ERR_PNPM_OUTDATED_LOCKFILE means lockfile and
//      manifests genuinely disagree -- a human commit, never an auto-heal.
// So reconcilable-vs-divergent is decided by ATTEMPTING the heal, not by
// matching reason prose. The census showed SIX distinct message strings under
// one deps-stale counter; pattern-matching them is the treadmill this ends.
//
// ZOD, TWO-AXIS, applied honestly. Axis 1 (runtime parse) belongs at the ONE
// real trust boundary: the pnpm subprocess NDJSON. worktree-deps-status.ts
// hand-narrows that data today and says why -- "this data comes from a
// subprocess, which is a trust boundary" -- so a schema is the house-correct
// form, matching close-worktree.ts's WorktreeCloseInputSchema.parse precedent.
// Axis 2 (z.infer as SSOT) covers the unions that cross module boundaries.
// Internal calls are NOT re-parsed: the rule forbids re-validating trusted
// internal data, and decideReconcile receives a probe another pure function in
// this repo produced.
//
// SOURCE IS REPORTED, not just the verdict. A classification reached by prose
// fallback is a degraded reading of a tool that changed its output; one reached
// by timeout is not a reading at all. Collapsing those into the same verdict
// hides the difference from the operator reading the report.
//
// FAILS CLOSED throughout, mirroring gate:agent and interpretDepsProbe: only an
// explicit exit 0 is reconciled. A timeout is never a pass.
import { describe, it, expect } from 'vitest';
import {
  decideReconcile,
  healArgs,
  interpretHealResult,
  PnpmNdjsonRecordSchema,
  RECONCILE_EXIT,
  reconcileExitCode,
  resolveExecute,
} from './deps-reconcile.js';
const NL = String.fromCharCode(10);
// TIER 3. Consumes the SAME DepsProbe union tier 2 produces, so detection keeps
// exactly one home and this module never re-derives state.
describe('decideReconcile (which worktrees may be healed)', () => {
  it('skips a healthy worktree without spawning anything', () => {
    expect(decideReconcile({ kind: 'deps-ok' })).toEqual({
      action: 'skip',
      reason: 'deps-ok',
    });
  });
  it('plans a heal for a drifted worktree', () => {
    expect(
      decideReconcile({
        kind: 'deps-stale',
        reason: 'The value of the overrides setting has changed',
      }).action,
    ).toBe('heal');
  });
  it('NEVER heals a toolchain-blocked worktree: pnpm itself is the broken thing', () => {
    const plan = decideReconcile({
      kind: 'toolchain-blocked',
      reason: 'pnpm v11.13.0 is a broken release and cannot be installed',
    });
    expect(
      plan.action,
      'installing where pnpm cannot run is a guaranteed-failing retry, every run, forever',
    ).toBe('skip');
    expect(plan.action === 'skip' && plan.reason).toBe('toolchain-blocked');
  });
  it('carries the drift reason into the plan so the report stays actionable', () => {
    const plan = decideReconcile({
      kind: 'deps-stale',
      reason: 'The workspace structure has changed since last install',
    });
    expect(plan.action === 'heal' && plan.detail).toContain('workspace structure');
  });
});
// The argv is pinned as a CONTRACT, not an implementation detail: an edit that
// swapped in --no-frozen-lockfile or --force would silently convert a
// non-mutating reconcile into a lockfile rewrite across every worktree.
describe('healArgs (non-mutating by construction)', () => {
  it('installs with the frozen lockfile', () => {
    expect(healArgs()).toContain('--frozen-lockfile');
  });
  it('requests NDJSON so failures are classified by code, not prose', () => {
    expect(healArgs()).toContain('--reporter=ndjson');
  });
  it('NEVER passes a flag that could rewrite the lockfile', () => {
    const args = healArgs().join(' ');
    expect(args.includes('--no-frozen-lockfile')).toBe(false);
    expect(args.includes('--force')).toBe(false);
    expect(args.includes('--fix-lockfile')).toBe(false);
    expect(args.includes('--lockfile-only')).toBe(false);
  });
  it('NEVER purges node_modules: pnpm ci would re-download 1807 packages per worktree', () => {
    expect(healArgs().join(' ').includes('clean')).toBe(false);
  });
});
// AXIS 1. The subprocess is the trust boundary, so the record is PARSED, never
// cast. safeParse (not parse) because a malformed line must degrade the run to
// a fail-closed verdict, not crash the whole sweep on worktree 7 of 45.
describe('PnpmNdjsonRecordSchema (the one real trust boundary)', () => {
  it('accepts a well-formed pnpm error record', () => {
    const rec = { level: 'error', err: { code: 'ERR_PNPM_X', message: 'boom' } };
    expect(PnpmNdjsonRecordSchema.safeParse(rec).success).toBe(true);
  });
  it('REJECTS a record whose err.code is not a string', () => {
    const rec = { level: 'error', err: { code: 7, message: 'boom' } };
    expect(PnpmNdjsonRecordSchema.safeParse(rec).success).toBe(false);
  });
  it('REJECTS a non-object payload rather than coercing it', () => {
    expect(PnpmNdjsonRecordSchema.safeParse('error').success).toBe(false);
    expect(PnpmNdjsonRecordSchema.safeParse(null).success).toBe(false);
  });
});
describe('interpretHealResult (outcome IS the classifier)', () => {
  it('reads exit 0 as reconciled', () => {
    expect(interpretHealResult(0, '')).toEqual({ kind: 'reconciled', source: 'exit-zero' });
  });
  it('classifies ERR_PNPM_OUTDATED_LOCKFILE as divergent via the structured record', () => {
    const rec = JSON.stringify({
      level: 'error',
      err: {
        code: 'ERR_PNPM_OUTDATED_LOCKFILE',
        message: 'Cannot install with frozen-lockfile because pnpm-lock.yaml is not up to date',
      },
    });
    const out = interpretHealResult(1, rec);
    expect(out.kind).toBe('divergent');
    expect(out.source).toBe('ndjson');
  });
  it('skips interleaved noise and still finds the record', () => {
    const rec = JSON.stringify({
      level: 'error',
      err: { code: 'ERR_PNPM_OUTDATED_LOCKFILE', message: 'specifiers do not match' },
    });
    expect(interpretHealResult(1, 'WARN Request took 414ms' + NL + rec).source).toBe('ndjson');
  });
  it('falls back to prose but REPORTS the degradation rather than hiding it', () => {
    const out = interpretHealResult(
      1,
      'ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with frozen-lockfile',
    );
    expect(out.kind).toBe('divergent');
    expect(
      out.source,
      'a verdict read from prose means pnpm changed its output; the operator must be able to see that',
    ).toBe('prose-fallback');
  });
  it('reports any OTHER non-zero exit as failed, distinct from divergent', () => {
    const rec = JSON.stringify({
      level: 'error',
      err: { code: 'ERR_PNPM_FETCH_404', message: 'registry unreachable' },
    });
    expect(
      interpretHealResult(1, rec).kind,
      'a network failure is not a lockfile disagreement; conflating them sends the operator to edit a manifest over a flaky registry',
    ).toBe('failed');
  });
  it('FAILS CLOSED: a timeout kill (null exit code) is never reconciled', () => {
    const out = interpretHealResult(null, '');
    expect(out.kind).not.toBe('reconciled');
    expect(out.source).toBe('timeout');
  });
  it('FAILS CLOSED: unparseable output on a non-zero exit is never reconciled', () => {
    const out = interpretHealResult(1, 'some unrelated explosion');
    expect(out.kind).not.toBe('reconciled');
    expect(out.source).toBe('unparseable');
  });
  it('always carries a non-empty reason on a non-reconciled outcome', () => {
    const out = interpretHealResult(1, '');
    expect(out.kind !== 'reconciled' && out.reason.length > 0).toBe(true);
  });
});
// DRY-RUN BY DEFAULT, matching every mutating task here (repair:*,
// intake:redrive) and the 2026 remediation-CLI convention: preview is default,
// applying is opt-in. Consent is explicit, never ambient.
describe('resolveExecute (dry-run is the default)', () => {
  it('previews when no flag is given', () => {
    expect(resolveExecute([])).toBe(false);
  });
  it('mutates ONLY on an explicit --execute', () => {
    expect(resolveExecute(['--execute'])).toBe(true);
  });
  it('does not treat an unrelated flag as consent', () => {
    expect(resolveExecute(['--verbose'])).toBe(false);
  });
});
// GRADED exit codes, matching pr:follow (0/1/2/3) and audit:ci-minutes (2).
// A single non-zero would tell the operator something broke but not which
// action to take -- and the two outcomes need OPPOSITE actions: divergent means
// go fix a lockfile and commit it; failed means investigate the tool or the
// network and re-run. failed DOMINATES because it means the sweep itself is
// untrustworthy, so its divergent findings may be incomplete.
describe('reconcileExitCode (gates, does not merely print)', () => {
  it('is 0 when every candidate reconciled', () => {
    expect(reconcileExitCode({ reconciled: 9, divergent: 0, failed: 0, skipped: 33 }))
      .toBe(RECONCILE_EXIT.ok);
  });
  it('is 0 for a run with nothing to do', () => {
    expect(reconcileExitCode({ reconciled: 0, divergent: 0, failed: 0, skipped: 45 }))
      .toBe(RECONCILE_EXIT.ok);
  });
  it('reports genuine lockfile divergence with its OWN code', () => {
    expect(reconcileExitCode({ reconciled: 8, divergent: 1, failed: 0, skipped: 33 }))
      .toBe(RECONCILE_EXIT.divergent);
  });
  it('reports a heal failure with a DIFFERENT code than divergence', () => {
    expect(reconcileExitCode({ reconciled: 0, divergent: 0, failed: 1, skipped: 44 }))
      .toBe(RECONCILE_EXIT.failed);
  });
  it('lets failed DOMINATE divergent: an untrustworthy sweep outranks its findings', () => {
    expect(reconcileExitCode({ reconciled: 0, divergent: 3, failed: 1, skipped: 41 }))
      .toBe(RECONCILE_EXIT.failed);
  });
  it('does not fail a run merely because worktrees were skipped', () => {
    expect(reconcileExitCode({ reconciled: 0, divergent: 0, failed: 0, skipped: 4 }))
      .toBe(RECONCILE_EXIT.ok);
  });
  it('keeps every exit code distinct so the operator can branch on it', () => {
    const codes = [RECONCILE_EXIT.ok, RECONCILE_EXIT.divergent, RECONCILE_EXIT.failed];
    expect(new Set(codes).size).toBe(codes.length);
  });
});
// 2 IS RESERVED FOR USAGE, per the universal CLI convention (0 success, 1
// general error, 2 usage error; 1-2 documented as reserved). An earlier draft
// of the core put failed on 2, which would have made an operator typo and a
// failed 45-worktree sweep indistinguishable in the same tool. These
// assertions exist so that collision cannot be reintroduced silently, and so
// the driver has one vocabulary to import rather than inventing its own.
describe('RECONCILE_EXIT vocabulary (usage stays reserved)', () => {
  it('reserves 2 for usage error, per the universal CLI convention', () => {
    expect(RECONCILE_EXIT.usage).toBe(2);
  });
  it('keeps success at 0', () => {
    expect(RECONCILE_EXIT.ok).toBe(0);
  });
  it('does NOT put a domain outcome on the reserved usage code', () => {
    expect(
      RECONCILE_EXIT.failed,
      'a failed sweep and an operator typo must never share an exit code',
    ).not.toBe(RECONCILE_EXIT.usage);
    expect(RECONCILE_EXIT.divergent).not.toBe(RECONCILE_EXIT.usage);
  });
  it('keeps every code in the set distinct so the operator can branch on it', () => {
    const codes = Object.values(RECONCILE_EXIT);
    expect(new Set(codes).size).toBe(codes.length);
  });
  it('stays inside the low range this repo already uses (pr:follow exits 0..3)', () => {
    for (const c of Object.values(RECONCILE_EXIT)) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(3);
    }
  });
});
