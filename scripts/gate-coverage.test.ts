// scripts/gate-coverage.test.ts
// RED (t86, 2026-08-05): pure planners for //#gate:coverage -- the pre-push
// coverage gate, lifted out of an inline YAML bash string.
//
// WHY THIS EXISTS. The pre-push hook died THREE times on 2026-08-05 with
//   BlockingIOError: [Errno 11] write could not complete without blocking
// while tests were PASSING. The cause is not the payload but its VOLUME: the
// hook streamed every workspace's vitest output through pre-commit's captured
// pipe, the pipe filled, and a write() to a non-blocking fd returned EAGAIN.
// The same failure is documented across doit, uwsgi, pytest and Cloud Run, and
// the remedy in every report is to reduce what crosses the pipe.
//
// WHY A TASK AND NOT A YAML EDIT. The gate lived as a ~300-character inline
// bash string in .pre-commit-config.yaml: flock, the recursive coverage run
// and the merge step all re-declared in YAML, untested and invisible to
// //#test:scripts. Adding a reporter flag there would fix today's symptom and
// leave the class -- the next change edits an untestable literal again. 2026
// guidance is that hooks must be THIN and call a task, so hooks, terminal and
// CI run the exact same checks with ONE place to change behaviour. That is
// also this repo's own standing rule: every project op is a Turbo task or a
// committed script.
//
// THE GATE ITSELF IS UNCHANGED. Same tasks, same flock, same 90/90/90/90
// merge, same non-zero propagation. Only the hook's shape and where output
// goes differ.
import { describe, it, expect } from 'vitest';
import {
  coverageArgs,
  GATE_COVERAGE_EXIT,
  gateExitCode,
  gateLogPath,
  lockArgs,
  mergeArgs,
} from './gate-coverage.js';
describe('lockArgs (cross-worktree serialization is preserved)', () => {
  it('waits rather than failing when another worktree holds the gate', () => {
    const a = lockArgs('/home/u/.cache/fleetmanagement/gate.lock');
    expect(a).toContain('-w');
    expect(
      Number(a[a.indexOf('-w') + 1]),
      'six parallel worktrees starve an 8-core host; queueing is the documented design',
    ).toBeGreaterThanOrEqual(3600);
  });
  it('locks a path under HOME, never repo-relative', () => {
    expect(
      lockArgs('/home/u/.cache/fleetmanagement/gate.lock').join(' '),
      'worktrees have different paths, so a repo-local lock serializes nothing',
    ).toContain('/home/u/.cache/fleetmanagement/gate.lock');
  });
});
describe('coverageArgs (same gate, less pipe traffic)', () => {
  it('runs every workspace that defines the task', () => {
    const a = coverageArgs();
    expect(a).toContain('-r');
    expect(a).toContain('--if-present');
    expect(a).toContain('test:coverage');
  });
  it('keeps workspace-concurrency at 1', () => {
    expect(
      coverageArgs().join(' '),
      'intra-serialization is what keeps PGlite WASM cold-starts inside the hook budget',
    ).toContain('--workspace-concurrency=1');
  });
  // NO REPORTER FLAG, and its absence is the lesson. The first fix appended
  // --reporter=dot through `pnpm -r ... --`. It never reached vitest: these
  // test:coverage scripts are compound shell strings and recursive pnpm does
  // not forward trailing args into them. The unit test asserted the flag was
  // in the argv and PASSED, while the push failed again with the identical
  // BlockingIOError -- a test of my own intent rather than of the behaviour.
  // Output volume is now handled by redirecting to a file, which needs no
  // cooperation from those scripts. This asserts the flag is NOT here, so no
  // one reintroduces a remedy that cannot work.
  it('does NOT carry a reporter flag: it provably cannot reach a compound script', () => {
    expect(coverageArgs().join(' ').includes('--reporter')).toBe(false);
  });
  it('never weakens the run with --passWithNoTests or --bail', () => {
    const s = coverageArgs().join(' ');
    expect(s.includes('--passWithNoTests')).toBe(false);
    expect(s.includes('--bail')).toBe(false);
  });
});
describe('gateLogPath (output leaves the pipe entirely)', () => {
  it('writes beside the lock under HOME, never into the repo tree', () => {
    const p = gateLogPath('/home/u/.cache/fleetmanagement');
    expect(p.startsWith('/home/u/.cache/fleetmanagement')).toBe(true);
    expect(
      p.includes('/code/'),
      'a log inside the worktree would surface in git status and be swept by a clean',
    ).toBe(false);
  });
  it('is a single stable path, so a failure replay knows where to look', () => {
    expect(gateLogPath('/tmp/x')).toBe(gateLogPath('/tmp/x'));
  });
});
describe('mergeArgs (the 90/90/90/90 gate is untouched)', () => {
  it('invokes the same merge script CI uses', () => {
    expect(mergeArgs().join(' ')).toContain('scripts/merge-coverage.mjs');
  });
  it('points at the merged coverage directory apps/api emits', () => {
    expect(mergeArgs().join(' ')).toContain('apps/api/coverage/merged');
  });
});
describe('gateExitCode (a real failure must propagate)', () => {
  it('is 0 only when both steps succeeded', () => {
    expect(gateExitCode({ coverage: 0, merge: 0 })).toBe(GATE_COVERAGE_EXIT.ok);
  });
  it('propagates a coverage failure', () => {
    expect(
      gateExitCode({ coverage: 1, merge: 0 }),
      'the historical bug was a bash || echo swallowing a real failure into exit 0',
    ).not.toBe(GATE_COVERAGE_EXIT.ok);
  });
  it('propagates a merge/threshold failure', () => {
    expect(gateExitCode({ coverage: 0, merge: 1 })).not.toBe(GATE_COVERAGE_EXIT.ok);
  });
  it('lets the COVERAGE failure win when both fail: it is the earlier cause', () => {
    expect(gateExitCode({ coverage: 2, merge: 1 })).toBe(GATE_COVERAGE_EXIT.coverage);
  });
  it('keeps every code distinct', () => {
    const codes = Object.values(GATE_COVERAGE_EXIT);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
