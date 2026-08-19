// scripts/ci/deploy-stamp.test.ts
// Spec for deploy-time provenance stamping.
//
// ROOT CAUSE THIS ADDRESSES: railway-deploy.yml documents that all three
// services run in CLI-ONLY mode (Settings > Source connected to nothing) to
// prevent double-deploys. Railway only auto-injects RAILWAY_GIT_COMMIT_SHA for
// deploys triggered from a CONNECTED repo, so in CLI-only mode those git
// variables can never arrive -- by design, permanently. Dockerfile.api
// therefore baked GIT_SHA as an empty string and /health/version reported
// unknown forever, leaving deploy verification a manual ritual.
//
// ---- AND THE CALL SHAPE, 2026-08-19 ----
//
// PR #618's deploy failed mid-stamp: BUILD_TIME set successfully, then
// GIT_BRANCH -- issued immediately after -- failed with "error decoding
// response body: expected value at line 1 column 1". That is Railway's CLI
// JSON-parsing a NON-JSON reply, which is what a rate limit returns; Railway's
// own maintainers describe it that way, noting the CLI should print the 429
// instead of the serde failure.
//
// The defect was ours: one CLI invocation PER VARIABLE, three per service and
// nine across api, worker and ops-web, in a loop with no pause. `railway
// variables` takes repeated --set pairs in ONE request, so the fix is to stop
// making N calls where one will do -- not to retry into the limit, which is
// slower and still flaky.
//
// A PREVIOUS TEST HERE WOULD HAVE BLOCKED THAT FIX. It asserted "never emits
// --set", on a reading of the CLI help that marks --set legacy. The legacy form
// is the `variables set K=V` SUBCOMMAND; --set is the current flag on
// `railway variables` and the only form accepting several pairs. That
// assertion encoded a misreading as a contract -- the same shape as the
// --reporter=dot test that asserted intent rather than behaviour.
import { describe, it, expect } from 'vitest';
import {
  buildStampVariables,
  railwayVariablesArgs,
  evaluateDeployedSha,
} from './deploy-stamp.js';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

describe('buildStampVariables', () => {
  it('returns the three provenance variables', () => {
    const v = buildStampVariables(SHA, 'main', '2026-07-28T00:00:00Z');
    expect(v).toEqual({
      GIT_SHA: SHA,
      GIT_BRANCH: 'main',
      BUILD_TIME: '2026-07-28T00:00:00Z',
    });
  });
  it('rejects a sha that is not 40 hex chars, failing closed', () => {
    expect(() => buildStampVariables('abc', 'main', 'now')).toThrow();
  });
  it('rejects a blank sha rather than stamping an empty value', () => {
    expect(() => buildStampVariables('', 'main', 'now')).toThrow();
  });
  it('rejects a blank branch', () => {
    expect(() => buildStampVariables(SHA, '   ', 'now')).toThrow();
  });
});

describe('railwayVariablesArgs stamps in ONE call', () => {
  const vars = { GIT_SHA: SHA, GIT_BRANCH: 'main', BUILD_TIME: '2026-08-19T00:00:00Z' };

  // THE FIX, as an assertion. Three variables previously meant three CLI
  // invocations and three API round-trips; the second one is what Railway
  // rate-limited during PR #618's deploy.
  it('returns a SINGLE command however many variables are stamped', () => {
    const cmd = railwayVariablesArgs('ops-web', vars);
    expect(Array.isArray(cmd)).toBe(true);
    expect(typeof cmd[0]).toBe('string');
    expect(cmd[0]).toBe('variables');
  });

  it('carries every variable as its own --set pair', () => {
    const cmd = railwayVariablesArgs('ops-web', vars);
    expect(cmd.filter((a) => a === '--set')).toHaveLength(3);
    expect(cmd).toContain('GIT_SHA=' + SHA);
    expect(cmd).toContain('GIT_BRANCH=main');
    expect(cmd).toContain('BUILD_TIME=2026-08-19T00:00:00Z');
  });

  // The legacy form is the SUBCOMMAND `variables set K=V`, which takes one pair
  // and is exactly the shape that caused the rate limit.
  it('does NOT use the legacy set SUBCOMMAND', () => {
    expect(railwayVariablesArgs('api', vars)).not.toContain('set');
  });

  // Without it, every stamp triggers its own redeploy: set -> deploy -> set.
  it('always passes --skip-deploys', () => {
    expect(railwayVariablesArgs('api', vars)).toContain('--skip-deploys');
  });

  it('names the service exactly once', () => {
    const cmd = railwayVariablesArgs('worker', vars);
    expect(cmd.filter((a) => a === '--service')).toHaveLength(1);
    expect(cmd).toContain('worker');
  });

  // Ordering is not semantic, but an unstable one makes two identical deploys
  // produce different CI logs and defeats diffing.
  it('sorts the pairs so the command is reproducible', () => {
    const a = railwayVariablesArgs('api', vars).join(' ');
    const b = railwayVariablesArgs('api', { ...vars }).join(' ');
    expect(a).toBe(b);
    expect(a.indexOf('BUILD_TIME=')).toBeLessThan(a.indexOf('GIT_BRANCH='));
    expect(a.indexOf('GIT_BRANCH=')).toBeLessThan(a.indexOf('GIT_SHA='));
  });

  it('still stamps correctly for a single variable', () => {
    const cmd = railwayVariablesArgs('api', { GIT_SHA: SHA });
    expect(cmd.filter((a) => a === '--set')).toHaveLength(1);
    expect(cmd).toContain('GIT_SHA=' + SHA);
  });

  it('rejects an empty service name', () => {
    expect(() => railwayVariablesArgs('', vars)).toThrow();
  });
  it('rejects an empty variable set rather than running a no-op', () => {
    expect(() => railwayVariablesArgs('api', {})).toThrow();
  });
  it('rejects a value containing a newline, which would break the pair', () => {
    expect(() => railwayVariablesArgs('api', { X: 'a' + String.fromCharCode(10) + 'b' })).toThrow();
  });
});

describe('evaluateDeployedSha', () => {
  it('passes when the live sha matches what was deployed', () => {
    const r = evaluateDeployedSha({ sha: SHA }, SHA);
    expect(r.ok).toBe(true);
  });
  it('FAILS on unknown, the exact state that hid the missing stamp', () => {
    const r = evaluateDeployedSha({ sha: 'unknown' }, SHA);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('unknown');
  });
  it('FAILS on a blank sha', () => {
    expect(evaluateDeployedSha({ sha: '' }, SHA).ok).toBe(false);
  });
  it('FAILS on a mismatch, naming both sides', () => {
    const r = evaluateDeployedSha({ sha: OTHER }, SHA);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain(OTHER.slice(0, 7));
    expect(r.reason).toContain(SHA.slice(0, 7));
  });
  it('FAILS CLOSED on a payload with no sha field', () => {
    expect(evaluateDeployedSha({}, SHA).ok).toBe(false);
  });
  it('FAILS CLOSED on a non-object payload', () => {
    expect(evaluateDeployedSha(null, SHA).ok).toBe(false);
  });
  it('FAILS CLOSED on an array payload', () => {
    expect(evaluateDeployedSha([], SHA).ok).toBe(false);
  });
});
