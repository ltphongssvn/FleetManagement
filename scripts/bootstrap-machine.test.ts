// scripts/bootstrap-machine.test.ts
// Outside-in TDD for the machine bootstrap. PURE rules only -- no disk, no
// spawning. The imperative shell lives in bootstrap-machine-cli.ts.
//
// WHY THIS EXISTS. Every credential guard this repo has -- detect-secrets,
// detect-private-key, check-env-files, block-large-binaries -- lives ONLY in
// pre-commit. A clone with no hooks installed has NONE of them, and nothing
// told anyone. On 2026-08-11 a fresh machine committed 88357d0, a change made
// entirely of age key material, with zero secret scanning. It passed because
// nothing ran, not because it was clean.
//
// The second half of the defect is subtler: .pre-commit-config.yaml declares
// THREE hook types -- pre-commit, pre-push and commit-msg -- and bare
// "pre-commit install" installs only the first. Fixing this by hand on one
// machine left two of three still missing, which is precisely the kind of
// silent partial fix that reads as done.
import { describe, it, expect } from 'vitest';
import {
  REQUIRED_HOOK_TYPES,
  REQUIRED_TOOLS,
  decideBootstrap,
  describeFinding,
  parseDeclaredStages,
} from './bootstrap-machine.js';

describe('the hook types we must install are derived, never hardcoded twice', () => {
  it('reads every stage the config declares', () => {
    const yaml = [
      'repos:',
      '  - repo: local',
      '    hooks:',
      '      - id: a',
      '        stages: [pre-push]',
      '      - id: b',
      '        stages: [commit-msg]',
    ].join(String.fromCharCode(10));
    expect(parseDeclaredStages(yaml)).toEqual(['commit-msg', 'pre-commit', 'pre-push']);
  });

  it('always includes pre-commit even when no hook names it explicitly', () => {
    const yaml = ['repos:', '  - repo: local', '    hooks:', '      - id: a'].join(
      String.fromCharCode(10),
    );
    expect(parseDeclaredStages(yaml)).toEqual(['pre-commit']);
  });

  it('ignores a stage that is not a real git hook point', () => {
    const yaml = ['hooks:', '  - stages: [manual]'].join(String.fromCharCode(10));
    expect(parseDeclaredStages(yaml)).toEqual(['pre-commit']);
  });

  it('exposes the three this repo declares as the SSOT constant', () => {
    expect(REQUIRED_HOOK_TYPES).toEqual(['commit-msg', 'pre-commit', 'pre-push']);
  });
});

describe('bootstrap decides from observed state, not from hope', () => {
  const ok = {
    toolsPresent: [...REQUIRED_TOOLS],
    installedHookTypes: [...REQUIRED_HOOK_TYPES],
    isCi: false,
  };

  it('reports ready when every tool and every hook type is present', () => {
    expect(decideBootstrap(ok)).toEqual({ outcome: 'ready' });
  });

  it('names the missing hook types rather than reinstalling blindly', () => {
    const d = decideBootstrap({ ...ok, installedHookTypes: ['pre-commit'] });
    expect(d).toEqual({ outcome: 'install', hookTypes: ['commit-msg', 'pre-push'] });
  });

  it('treats a partial install as incomplete -- one of three is not done', () => {
    const d = decideBootstrap({ ...ok, installedHookTypes: [] });
    expect(d.outcome).toBe('install');
  });

  it('blocks on a missing tool, because installing hooks that cannot run is worse', () => {
    const d = decideBootstrap({ ...ok, toolsPresent: ['pre-commit'] });
    expect(d).toEqual({ outcome: 'blocked', missingTools: ['detect-secrets'] });
  });

  it('checks tools BEFORE hooks: a hook whose binary is absent fails at commit time', () => {
    const d = decideBootstrap({ ...ok, toolsPresent: [], installedHookTypes: [] });
    expect(d.outcome).toBe('blocked');
  });

  it('skips entirely in CI, where hooks never run and the tools are absent', () => {
    expect(decideBootstrap({ toolsPresent: [], installedHookTypes: [], isCi: true })).toEqual({
      outcome: 'skipped',
    });
  });
});

describe('findings tell the operator what to do', () => {
  it('names the remedy for a missing tool', () => {
    expect(describeFinding({ outcome: 'blocked', missingTools: ['detect-secrets'] })).toContain(
      'brew install',
    );
  });

  it('names every missing tool, not just the first', () => {
    const msg = describeFinding({
      outcome: 'blocked',
      missingTools: ['pre-commit', 'detect-secrets'],
    });
    expect(msg).toContain('pre-commit');
    expect(msg).toContain('detect-secrets');
  });

  it('says what it is about to install', () => {
    expect(describeFinding({ outcome: 'install', hookTypes: ['pre-push'] })).toContain('pre-push');
  });

  it('is quiet and affirmative when already ready', () => {
    expect(describeFinding({ outcome: 'ready' })).toContain('ready');
  });

  it('explains the CI skip rather than looking like a failure', () => {
    expect(describeFinding({ outcome: 'skipped' }).toLowerCase()).toContain('ci');
  });
});
