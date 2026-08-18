// scripts/bootstrap-machine-wiring.guard.test.ts
// ARCHITECTURAL GUARD: the machine bootstrap must stay wired and stay safe.
//
// The behaviour tests prove the rules are CORRECT. This one proves they are
// REACHABLE, which is the failure mode this whole arc exists to remove:
// pre-commit hooks were correct and simply never installed, so four credential
// guards were absent on a fresh machine and nothing said so.
//
// Reads SOURCE TEXT rather than importing, deliberately. The point is to catch
// an EDIT: importing would succeed happily against a file whose CI skip or soft
// mode had been rewritten.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REQUIRED_HOOK_TYPES, parseDeclaredStages } from './bootstrap-machine.js';

const ROOT = join(import.meta.dirname, '..');

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf-8');
}

interface RootManifest {
  readonly scripts?: Readonly<Record<string, string>>;
}

const manifest = JSON.parse(read('package.json')) as RootManifest;
const turbo = read('turbo.jsonc');
const cli = read('scripts/bootstrap-machine-cli.ts');

/** Bracket access throughout: scripts/tsconfig.json sets
 *  noPropertyAccessFromIndexSignature, so dot access on a Record property is a
 *  TS4111 compile error. Caught by typecheck:scripts, invisible to lint. */
function script(name: string): string | undefined {
  return manifest.scripts?.[name];
}

describe('the op is registered, not an ad-hoc CLI', () => {
  it('is a committed root script', () => {
    expect(script('bootstrap:machine')).toBeDefined();
  });

  it('is a root-scoped turbo task', () => {
    expect(turbo).toContain('"//#bootstrap:machine"');
  });

  it('carries a description -- the SSOT this repo documents in', () => {
    const block = turbo.slice(turbo.indexOf('"//#bootstrap:machine"'));
    expect(block).toContain('"description"');
  });
});

describe('a fresh clone self-heals without anyone remembering the task exists', () => {
  it('prepare runs the bootstrap', () => {
    expect(script('prepare')).toContain('bootstrap-machine-cli');
  });

  it('prepare passes --soft, because it fires on every CI install', () => {
    expect(script('prepare')).toContain('--soft');
  });

  it('the direct op does NOT pass --soft: an operator who asked deserves an exit code', () => {
    expect(script('bootstrap:machine')).not.toContain('--soft');
  });
});

describe('safety properties cannot be edited away silently', () => {
  it('CI is detected, so eight workflows cannot redden on a workstation concern', () => {
    expect(cli).toContain('GITHUB_ACTIONS');
    expect(cli).toContain('isCi');
  });

  it('reads the git COMMON dir -- worktrees share one hooks directory', () => {
    expect(cli).toContain('--git-common-dir');
  });

  it('counts a hook only when pre-commit wrote it', () => {
    expect(cli).toContain('writtenByPreCommit');
  });

  it('verifies by RE-READING after installing, never by trusting an exit code', () => {
    const after = cli.slice(cli.indexOf('installHooks(finding.hookTypes)'));
    expect(after).toContain('verifiedHookTypes');
  });
});

describe('the required hook set is derived from the config, never typed twice', () => {
  it('matches every installable stage the real config declares', () => {
    expect(parseDeclaredStages(read('.pre-commit-config.yaml'))).toEqual([...REQUIRED_HOOK_TYPES]);
  });

  it('the config still declares the guards that made this arc necessary', () => {
    const config = read('.pre-commit-config.yaml');
    for (const id of ['detect-secrets', 'check-env-files', 'detect-private-key']) {
      expect(config).toContain(id);
    }
  });
});
