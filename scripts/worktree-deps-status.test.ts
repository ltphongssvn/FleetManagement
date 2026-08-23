// scripts/worktree-deps-status.test.ts
// Two-tier dependency-drift detection for sync:worktrees.
//
// ROOT CAUSE. pnpm v11 defaults verifyDepsBeforeRun to install, self-healing a
// drifted node_modules before every script. This repo sets it to warn on
// purpose: with 37 worktrees and 1810 packages on a 9.7GiB box an implicit
// install mid-gate is destructive (pnpm issues 11556, 11865). But warn only
// PRINTS, and sync:worktrees fast-forwards refs without touching node_modules,
// so drift accumulated silently until the canonical root ran sync:worktrees
// itself on turbo 2.10.6 while origin/main and origin/develop both declared
// 2.10.7.
//
// TIER 1 classifyDepsCandidate -- free mtime comparison against
// lastValidatedTimestamp in .pnpm-workspace-state-v1.json.
// TIER 2 interpretDepsProbe -- authoritative, candidates only, because the
// probe costs ~7.7s and 37 worktrees would add ~4.7 minutes to a 30s task.
//
// THIRD OUTCOME, from the first live run: four worktrees pin pnpm@11.13.0 in
// packageManager. pnpm refuses to install that version -- 11.13.1 through
// 11.16.0 shipped tarballs missing most compiled files (pnpm issue 13164, all
// republished) and 11.13.0 broke Linux installs outright (issue 13067). pnpm
// cannot RUN in those worktrees, so the probe fails for a reason that is not
// drift. Reporting it as deps-stale would send someone to run pnpm install
// where pnpm itself is the broken thing, so it gets its own outcome.
//
// ENV SANITIZING. The probe is spawned from inside a pnpm process, and a child
// inherits npm_config_* from the parent. Env config OUTRANKS the --config.
// flag, so an inherited npm_config_verify_deps_before_run would silently
// downgrade the probe back to warn and make every stale worktree read as
// healthy -- a confident zero. buildProbeEnv strips that whole namespace.
import { describe, it, expect } from 'vitest';
import {
  buildProbeEnv,
  classifyDepsCandidate,
  interpretDepsProbe,
  joinProbeStreams,
} from './worktree-deps-status.js';
const NL = String.fromCharCode(10);
describe('classifyDepsCandidate (tier 1, free)', () => {
  it('reports no-state when the workspace state file is absent', () => {
    expect(
      classifyDepsCandidate({
        stateFilePresent: false,
        lastValidatedTimestampMs: 0,
        newestManifestMtimeMs: 1000,
      }),
    ).toEqual({ kind: 'no-state' });
  });
  it('flags a candidate when a manifest is newer than the last validation', () => {
    expect(
      classifyDepsCandidate({
        stateFilePresent: true,
        lastValidatedTimestampMs: 1000,
        newestManifestMtimeMs: 1500,
      }),
    ).toEqual({ kind: 'suspect', staleByMs: 500 });
  });
  it('reports ok when every manifest predates the last validation', () => {
    expect(
      classifyDepsCandidate({
        stateFilePresent: true,
        lastValidatedTimestampMs: 2000,
        newestManifestMtimeMs: 1500,
      }),
    ).toEqual({ kind: 'ok' });
  });
  it('treats an exactly-equal timestamp as ok, not suspect', () => {
    expect(
      classifyDepsCandidate({
        stateFilePresent: true,
        lastValidatedTimestampMs: 1500,
        newestManifestMtimeMs: 1500,
      }),
    ).toEqual({ kind: 'ok' });
  });
  it('is suspect when the state file records no validation timestamp', () => {
    const r = classifyDepsCandidate({
      stateFilePresent: true,
      lastValidatedTimestampMs: 0,
      newestManifestMtimeMs: 1,
    });
    expect(r.kind).toBe('suspect');
  });
});
// STREAM- AND FORMAT-AGNOSTIC, from a real failure. The first working run
// reported every drifted worktree as 'probe failed with no diagnostic'
// output' -- non-zero exit, empty stderr -- while the same command standalone
// prints the ERR_PNPM_VERIFY_DEPS_BEFORE_RUN line. Fail-closed kept the verdict
// right but discarded the actionable reason, which is how a report becomes
// noise the operator learns to ignore.
//
// pnpm does not commit to a stream, and its own tracker says so: WARN lines
// land on stdout and break --json parsing (issues 10200, 10923), and verify-
// deps data reaches stdout even under --silent (issue 11636). So the caller
// hands BOTH streams to the parser rather than guessing.
//
// Preferring NDJSON is the durable half: pnpm errors are structured PnpmError
// objects with ERR_PNPM_ codes, and --reporter=ndjson emits them as records.
// Parsing a documented machine format beats scraping human prose that is free
// to be reworded in any release. Line-oriented parsing also tolerates the
// interleaved WARN noise those issues describe. The prose parser stays as a
// fallback, because a reporter that emits nothing must still not read as a
// pass.
describe('interpretDepsProbe (tier 2, authoritative)', () => {
  it('reads exit 0 as deps-ok', () => {
    expect(interpretDepsProbe(0, '')).toEqual({ kind: 'deps-ok' });
  });
  it('extracts the pnpm reason from a verify-deps failure', () => {
    const stderr =
      '[ERR_PNPM_VERIFY_DEPS_BEFORE_RUN] The workspace structure has changed since last install' +
      NL +
      'Run "pnpm install"';
    expect(interpretDepsProbe(1, stderr)).toEqual({
      kind: 'deps-stale',
      reason: 'The workspace structure has changed since last install',
    });
  });
  it('extracts the project id from a lockfile-mismatch failure', () => {
    const stderr =
      '[ERR_PNPM_VERIFY_DEPS_BEFORE_RUN] The lockfile in /x does not satisfy project of id apps/dispatcher-app';
    expect(interpretDepsProbe(1, stderr)).toEqual({
      kind: 'deps-stale',
      reason: 'The lockfile in /x does not satisfy project of id apps/dispatcher-app',
    });
  });
  it('classifies a POISONED pnpm pin as toolchain-blocked, never as drift', () => {
    const stderr = '[ERROR] pnpm v11.13.0 is a broken release and cannot be installed';
    expect(interpretDepsProbe(1, stderr)).toEqual({
      kind: 'toolchain-blocked',
      reason: 'pnpm v11.13.0 is a broken release and cannot be installed',
    });
  });
  it('classifies any pnpm ERROR line as toolchain-blocked', () => {
    const r = interpretDepsProbe(1, '[ERROR] something the toolchain refused');
    expect(r.kind).toBe('toolchain-blocked');
  });
  it('prefers the verify-deps reason when BOTH markers appear', () => {
    const stderr = '[ERROR] noise' + NL + '[ERR_PNPM_VERIFY_DEPS_BEFORE_RUN] real drift';
    expect(interpretDepsProbe(1, stderr)).toEqual({
      kind: 'deps-stale',
      reason: 'real drift',
    });
  });
  it('FAILS CLOSED: a non-zero exit with unparseable stderr is still stale', () => {
    const r = interpretDepsProbe(1, 'some unrelated explosion');
    expect(r.kind).toBe('deps-stale');
    expect(r.kind === 'deps-stale' && r.reason.length > 0).toBe(true);
  });
  it('FAILS CLOSED: a non-zero exit with no output at all is still stale', () => {
    expect(interpretDepsProbe(1, '')).toEqual({
      kind: 'deps-stale',
      reason: 'probe failed with no diagnostic output',
    });
  });
  it('prefers a structured NDJSON error record over prose', () => {
    const rec = JSON.stringify({
      level: 'error',
      err: {
        code: 'ERR_PNPM_VERIFY_DEPS_BEFORE_RUN',
        message: 'The lockfile in /x does not satisfy project of id .',
      },
    });
    expect(interpretDepsProbe(1, rec)).toEqual({
      kind: 'deps-stale',
      reason: 'The lockfile in /x does not satisfy project of id .',
    });
  });
  it('classifies a non-verify NDJSON error code as toolchain-blocked', () => {
    const rec = JSON.stringify({
      level: 'error',
      err: { code: 'ERR_PNPM_BROKEN_RELEASE', message: 'pnpm v11.13.0 is broken' },
    });
    expect(interpretDepsProbe(1, rec).kind).toBe('toolchain-blocked');
  });
  it('skips interleaved non-JSON noise and still finds the record', () => {
    const rec = JSON.stringify({
      level: 'error',
      err: { code: 'ERR_PNPM_VERIFY_DEPS_BEFORE_RUN', message: 'real drift' },
    });
    const mixed = 'WARN Request took 414ms' + String.fromCharCode(10) + rec;
    expect(interpretDepsProbe(1, mixed).kind).toBe('deps-stale');
  });
  it('falls back to prose when the reporter emitted no record', () => {
    const stderr = '[ERR_PNPM_VERIFY_DEPS_BEFORE_RUN] The workspace structure has changed';
    expect(interpretDepsProbe(1, stderr).kind).toBe('deps-stale');
  });
  it('joins both streams without gluing two lines together', () => {
    const combined = joinProbeStreams('alpha', 'beta');
    const lines = combined.split(String.fromCharCode(10));
    expect(lines).toContain('alpha');
    expect(lines).toContain('beta');
  });
  it('tolerates undefined streams from a killed process', () => {
    expect(joinProbeStreams(undefined, undefined)).toBe('');
  });
  it('never lets a timeout kill (null exit code) read as a pass', () => {
    expect(interpretDepsProbe(null, '').kind).toBe('deps-stale');
  });
});
// ROOT CAUSE, measured then confirmed against pnpm docs. The probe is spawned
// from INSIDE a pnpm process. pnpm v11 ignores .npmrc and reads env config from
// the PNPM_CONFIG_ namespace, so verifyDepsBeforeRun: warn in pnpm-workspace.yaml
// reaches the child as PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=warn -- and env config
// OUTRANKS the --config. flag. The probe was therefore silently downgraded to
// warn: it exited 0 in ~0.5s inside the task while the identical command took
// ~7.7s and exited 1 standalone, with identical cwd and argv. Every stale
// worktree read as healthy -- a green light produced by the measurement rather
// than by the thing measured, the worst possible failure for a drift detector.
//
// An earlier fix stripped npm_config_ only. That namespace is what pnpm v10
// used; v11 does not read it, so the fix changed nothing and the bug survived.
//
// The fix does not fight the precedence, it USES it: the highest-precedence
// channel is set explicitly, and the inherited config and lifecycle namespaces
// (npm_execpath, npm_lifecycle_*, npm_package_*, PNPM_SCRIPT_SRC_DIR, INIT_CWD)
// are stripped so nothing upstream can contradict it.
describe('buildProbeEnv (confident-zero guard)', () => {
  it('strips every inherited npm_config_ variable', () => {
    const out = buildProbeEnv({
      PATH: '/usr/bin',
      npm_config_verify_deps_before_run: 'warn',
      npm_config_registry: 'https://example.invalid',
    });
    expect(Object.keys(out).some((k) => k.toLowerCase().startsWith('npm_config_'))).toBe(false);
  });
  it('strips the uppercase npm spelling too', () => {
    const out = buildProbeEnv({ NPM_CONFIG_REGISTRY: 'https://example.invalid' });
    expect(Object.prototype.hasOwnProperty.call(out, 'NPM_CONFIG_REGISTRY')).toBe(false);
  });
  it('FORCES the verify setting through the highest-precedence channel', () => {
    const out = buildProbeEnv({ PATH: '/usr/bin' });
    expect(out['PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN']).toBe('error');
  });
  it('OVERRIDES an inherited warn value rather than preserving it', () => {
    const out = buildProbeEnv({
      PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'warn',
    });
    expect(out['PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN']).toBe('error');
  });
  it('strips every OTHER inherited PNPM_CONFIG_ setting', () => {
    const out = buildProbeEnv({
      PNPM_CONFIG_REGISTRY: 'https://example.invalid',
      PNPM_CONFIG_NODE_LINKER: 'hoisted',
    });
    expect(Object.prototype.hasOwnProperty.call(out, 'PNPM_CONFIG_REGISTRY')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, 'PNPM_CONFIG_NODE_LINKER')).toBe(false);
  });
  it('strips the pnpm lifecycle markers that signal a NESTED run', () => {
    const out = buildProbeEnv({
      PATH: '/usr/bin',
      npm_execpath: '/x/pnpm.cjs',
      npm_lifecycle_event: 'sync:worktrees',
      npm_package_name: 'fleet-management',
      PNPM_SCRIPT_SRC_DIR: '/x/repo',
      INIT_CWD: '/x/repo',
    });
    expect(Object.keys(out).sort()).toEqual(['PATH', 'PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN']);
  });
  it('keeps PNPM_HOME, which locates the binary rather than configuring it', () => {
    const out = buildProbeEnv({ PNPM_HOME: '/home/x/.pnpm' });
    expect(out['PNPM_HOME']).toBe('/home/x/.pnpm');
  });
  it('preserves everything else unchanged', () => {
    const out = buildProbeEnv({ PATH: '/usr/bin', HOME: '/home/x' });
    expect(out['PATH']).toBe('/usr/bin');
    expect(out['HOME']).toBe('/home/x');
  });
  it('drops undefined values so spawn never receives them', () => {
    const out = buildProbeEnv({ PATH: '/usr/bin', EMPTY: undefined });
    expect(Object.prototype.hasOwnProperty.call(out, 'EMPTY')).toBe(false);
  });
});
