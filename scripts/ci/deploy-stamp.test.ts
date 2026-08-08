// scripts/ci/deploy-stamp.test.ts
// RED spec for deploy-time provenance stamping.
//
// ROOT CAUSE THIS ADDRESSES: railway-deploy.yml documents that all three
// services run in CLI-ONLY mode (Settings > Source connected to nothing) to
// prevent double-deploys. Railway only auto-injects RAILWAY_GIT_COMMIT_SHA for
// deploys triggered from a CONNECTED repo, so in CLI-only mode those git
// variables can never arrive -- by design, permanently. Dockerfile.api
// therefore baked GIT_SHA as an empty string and /health/version reported
// unknown forever, leaving deploy verification a manual ritual.
//
// The workflow already resolves the exact deployed SHA and exposes it as
// gate.outputs.head_sha. The fix is to hand that value to Railway as a service
// variable before each railway up, then ASSERT it back from /health/version --
// 2026 practice is that provenance is stamped from the builder and verified
// automatically in a gate, never confirmed by hand.
//
// INDEXED ACCESS IS BOUND AND GUARDED (2026-08-08). cmds[0][2] was TS2532 under
// noUncheckedIndexedAccess. Optional chaining (cmds[0]?.[2]) was rejected: if a
// regression dropped a command the assertion would report "expected undefined
// to be GIT_BRANCH=main" instead of naming the real fault, and it would encode
// "this element might be absent" into a test whose entire premise is that it is
// not. Binding the row and asserting it exists is the house pattern (t63
// literal-guard, t15 assignment-audit): a real guard that fails legibly, and it
// removes the undefined from the type so the index that follows is legal.
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

describe('railwayVariablesArgs', () => {
  // The CLI help is the source of truth here, not memory: --set is documented
  // as LEGACY, superseded by the "variable set" subcommand. --skip-deploys is
  // real and is what stops each stamp from triggering its own redeploy, which
  // would otherwise loop: set variable -> deploy -> set variable -> deploy.
  const vars = { GIT_SHA: SHA, GIT_BRANCH: 'main' };

  it('emits one command per variable using the non-legacy subcommand', () => {
    const cmds = railwayVariablesArgs('api', vars);
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toEqual([
      'variable', 'set', 'GIT_BRANCH=main',
      '--service', 'api', '--skip-deploys',
    ]);
  });
  it('sorts variables so the emitted command sequence is reproducible', () => {
    const cmds = railwayVariablesArgs('api', vars);
    const [first, second] = cmds;
    expect(first, 'expected a first command to inspect').toBeDefined();
    expect(second, 'expected a second command to inspect').toBeDefined();
    if (first === undefined || second === undefined) return;
    expect(first[2]).toBe('GIT_BRANCH=main');
    expect(second[2]).toBe('GIT_SHA=' + SHA);
  });
  it('never emits the legacy --set flag', () => {
    const flat = railwayVariablesArgs('api', vars).flat();
    expect(flat).not.toContain('--set');
  });
  it('always passes --skip-deploys to avoid a set-deploy-set loop', () => {
    for (const cmd of railwayVariablesArgs('api', vars)) {
      expect(cmd).toContain('--skip-deploys');
    }
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
});
