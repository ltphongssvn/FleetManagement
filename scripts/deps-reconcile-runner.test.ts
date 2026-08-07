// scripts/deps-reconcile-runner.test.ts
// RED (t82 deps-reconcile arc, 2026-08-04): the sweep loop, tested by
// EXECUTION rather than by reading its own source.
//
// WHY THIS FILE EXISTS INSTEAD OF A BIGGER WIRING GUARD. The first draft of
// this arc put the sweep in a CLI driver and guarded it with a source-contract
// test: assertions like s.includes('buildProbeEnv') and
// indexOf('resolveExecute') < indexOf('spawnSync'). That approach has three
// defects that no amount of care removes. Comment stripping by startsWith('//')
// misses block comments, trailing comments and string literals -- a false
// positive of exactly this shape already fired on this arc, when a shell gate
// matched the phrase install --force inside a comment explaining why the flag
// is forbidden. Lexical position is not control flow, so reordering two helper
// functions could satisfy or break the ordering rule without changing
// behaviour. And the presence of an identifier never proves it reaches the call
// that needs it.
//
// The fix is not a cleverer guard. It is a smaller untestable surface. The
// sweep takes its spawn as a PARAMETER, so the real invariants -- never spawn
// without consent, never spawn for a skipped worktree, always sanitize the
// env, always bound the child -- are asserted by running the code and
// inspecting what it did. What remains in the CLI is argv in, spawnSync in,
// process.exit out: too small to hide a defect.
//
// The source-contract pattern stays correct for sync-worktrees.ts, which walks
// 45 real worktrees and genuinely cannot be unit-run. It was the wrong reach
// here, where injection was available and simply not taken.
import { describe, it, expect } from 'vitest';
import { runReconcile, type SpawnFn, type SpawnOutcome } from './deps-reconcile-runner.js';
import { RECONCILE_EXIT } from './deps-reconcile.js';
interface Call {
  cwd: string;
  args: readonly string[];
  env: Record<string, string>;
  timeout: number;
  killSignal: string;
}
// Records every invocation so the tests assert what the sweep DID, not what its
// source says. A spawn that is never called leaves an empty array -- the
// strongest possible form of the dry-run assertion.
function recorder(outcome: SpawnOutcome): { fn: SpawnFn; calls: Call[] } {
  const calls: Call[] = [];
  const fn: SpawnFn = (cwd, args, opts) => {
    calls.push({ cwd, args, env: opts.env, timeout: opts.timeout, killSignal: opts.killSignal });
    return outcome;
  };
  return { fn, calls };
}
const OK: SpawnOutcome = { status: 0, stdout: '', stderr: '' };
const DIVERGENT: SpawnOutcome = {
  status: 1,
  stdout: JSON.stringify({
    level: 'error',
    err: { code: 'ERR_PNPM_OUTDATED_LOCKFILE', message: 'lockfile is not up to date' },
  }),
  stderr: '',
};
const STALE = { kind: 'deps-stale', reason: 'The value of the overrides setting has changed' } as const;
const BLOCKED = { kind: 'toolchain-blocked', reason: 'pnpm v11.13.0 is a broken release' } as const;
const FRESH = { kind: 'deps-ok' } as const;
describe('runReconcile: consent gates every mutation', () => {
  it('DRY RUN spawns NOTHING, even with drifted worktrees', () => {
    const { fn, calls } = recorder(OK);
    const report = runReconcile([{ path: '/wt/a', probe: STALE }], fn, { execute: false });
    expect(
      calls.length,
      'dry-run must be provably inert; a preview that installs is not a preview',
    ).toBe(0);
    expect(report.summary.reconciled).toBe(0);
  });
  it('DRY RUN still REPORTS what it would have done', () => {
    const { fn } = recorder(OK);
    const report = runReconcile([{ path: '/wt/a', probe: STALE }], fn, { execute: false });
    expect(report.planned).toBe(1);
    expect(report.lines.join(' ')).toContain('/wt/a');
  });
  it('EXECUTE spawns exactly once per drifted worktree', () => {
    const { fn, calls } = recorder(OK);
    runReconcile(
      [
        { path: '/wt/a', probe: STALE },
        { path: '/wt/b', probe: STALE },
      ],
      fn,
      { execute: true },
    );
    expect(calls.length).toBe(2);
    expect(calls.map((c) => c.cwd)).toEqual(['/wt/a', '/wt/b']);
  });
});
describe('runReconcile: never touches what it must not touch', () => {
  it('NEVER spawns for a toolchain-blocked worktree', () => {
    const { fn, calls } = recorder(OK);
    const report = runReconcile([{ path: '/wt/broken', probe: BLOCKED }], fn, { execute: true });
    expect(
      calls.length,
      'pnpm cannot run there at all; installing would be a guaranteed-failing retry on every run forever',
    ).toBe(0);
    expect(report.summary.skipped).toBe(1);
  });
  it('NEVER spawns for a healthy worktree', () => {
    const { fn, calls } = recorder(OK);
    const report = runReconcile([{ path: '/wt/fine', probe: FRESH }], fn, { execute: true });
    expect(calls.length).toBe(0);
    expect(report.summary.skipped).toBe(1);
  });
  it('heals ONLY the drifted worktree in a mixed sweep', () => {
    const { fn, calls } = recorder(OK);
    const report = runReconcile(
      [
        { path: '/wt/fine', probe: FRESH },
        { path: '/wt/drift', probe: STALE },
        { path: '/wt/broken', probe: BLOCKED },
      ],
      fn,
      { execute: true },
    );
    expect(calls.map((c) => c.cwd)).toEqual(['/wt/drift']);
    expect(report.summary).toEqual({ reconciled: 1, divergent: 0, failed: 0, skipped: 2 });
  });
});
describe('runReconcile: every child is sanitized and bounded', () => {
  it('CONFIDENT-ZERO GUARD: strips inherited pnpm config from the child env', () => {
    const { fn, calls } = recorder(OK);
    runReconcile([{ path: '/wt/a', probe: STALE }], fn, {
      execute: true,
      sourceEnv: {
        PATH: '/usr/bin',
        npm_config_verify_deps_before_run: 'warn',
        PNPM_CONFIG_REGISTRY: 'https://example.invalid',
      },
    });
    const env = calls[0]?.env ?? {};
    expect(
      Object.keys(env).some((k) => k.toLowerCase().startsWith('npm_config_')),
      'this runs inside a pnpm process; inherited config outranks flags and once made every stale worktree read healthy',
    ).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(env, 'PNPM_CONFIG_REGISTRY')).toBe(false);
    expect(env['PATH']).toBe('/usr/bin');
  });
  it('BOUNDS the child so a hung install cannot wedge the sweep', () => {
    const { fn, calls } = recorder(OK);
    runReconcile([{ path: '/wt/a', probe: STALE }], fn, { execute: true });
    expect(calls[0]?.timeout).toBeGreaterThan(0);
    expect(calls[0]?.killSignal).toBe('SIGTERM');
  });
  it('passes the pinned non-mutating argv, never a hand-built one', () => {
    const { fn, calls } = recorder(OK);
    runReconcile([{ path: '/wt/a', probe: STALE }], fn, { execute: true });
    const args = calls[0]?.args.join(' ') ?? '';
    expect(args).toContain('install');
    expect(args).toContain('--frozen-lockfile');
    expect(args.includes('--no-frozen-lockfile')).toBe(false);
    expect(args.includes('--force')).toBe(false);
  });
});
describe('runReconcile: classification and exit', () => {
  it('counts a clean install as reconciled', () => {
    const { fn } = recorder(OK);
    const r = runReconcile([{ path: '/wt/a', probe: STALE }], fn, { execute: true });
    expect(r.summary.reconciled).toBe(1);
    expect(r.exitCode).toBe(RECONCILE_EXIT.ok);
  });
  it('counts an outdated-lockfile failure as divergent, and exits accordingly', () => {
    const { fn } = recorder(DIVERGENT);
    const r = runReconcile([{ path: '/wt/a', probe: STALE }], fn, { execute: true });
    expect(r.summary.divergent).toBe(1);
    expect(r.exitCode).toBe(RECONCILE_EXIT.divergent);
  });
  it('FAILS CLOSED: a killed child is failed, never reconciled', () => {
    const { fn } = recorder({ status: null, stdout: '', stderr: '' });
    const r = runReconcile([{ path: '/wt/a', probe: STALE }], fn, { execute: true });
    expect(r.summary.reconciled).toBe(0);
    expect(r.summary.failed).toBe(1);
    expect(r.exitCode).toBe(RECONCILE_EXIT.failed);
  });
  it('CONTINUES the sweep after one worktree fails', () => {
    let n = 0;
    const fn: SpawnFn = () => {
      n += 1;
      return n === 1 ? { status: null, stdout: '', stderr: '' } : OK;
    };
    const r = runReconcile(
      [
        { path: '/wt/a', probe: STALE },
        { path: '/wt/b', probe: STALE },
      ],
      fn,
      { execute: true },
    );
    expect(
      n,
      'one bad worktree must not abandon the other 44',
      ).toBe(2);
    expect(r.summary).toEqual({ reconciled: 1, divergent: 0, failed: 1, skipped: 0 });
  });
  it('names every worktree it acted on so the report is auditable', () => {
    const { fn } = recorder(DIVERGENT);
    const r = runReconcile([{ path: '/wt/a', probe: STALE }], fn, { execute: true });
    const text = r.lines.join(' ');
    expect(text).toContain('/wt/a');
    expect(text).toContain('divergent');
  });
  it('is a no-op with an empty target list', () => {
    const { fn, calls } = recorder(OK);
    const r = runReconcile([], fn, { execute: true });
    expect(calls.length).toBe(0);
    expect(r.exitCode).toBe(RECONCILE_EXIT.ok);
  });
});
