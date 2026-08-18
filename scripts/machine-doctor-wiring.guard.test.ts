// scripts/machine-doctor-wiring.guard.test.ts
// ARCHITECTURAL GUARD: the doctor must stay wired, stay read-only, and stay
// honest about what it cannot fix.
//
// The behaviour tests prove the verdicts are CORRECT. This one proves they are
// REACHABLE and that three properties cannot be edited away quietly. Same shape
// as env-bootstrap-wiring, ci-fast-covers-test-scripts and
// worktree-sweep-registered: an executable architectural constraint, so a
// future edit fails a test instead of failing silently in six weeks.
//
// Reads SOURCE TEXT rather than importing, deliberately: the point is to catch
// an EDIT, and importing would succeed happily against a file whose read-only
// contract had been rewritten.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAPABILITIES, remediationFor } from './machine-doctor.js';

const ROOT = join(import.meta.dirname, '..');

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf-8');
}

interface RootManifest {
  readonly scripts?: Readonly<Record<string, string>>;
}

const manifest = JSON.parse(read('package.json')) as RootManifest;
const turbo = read('turbo.jsonc');
const cli = read('scripts/machine-doctor-cli.ts');

describe('the op is registered, not an ad-hoc CLI', () => {
  it('is a committed root script', () => {
    expect(manifest.scripts?.['doctor']).toBeDefined();
  });

  it('is a root-scoped turbo task', () => {
    expect(turbo).toContain('"//#doctor"');
  });

  it('carries a description -- the SSOT this repo documents in', () => {
    expect(turbo.slice(turbo.indexOf('"//#doctor"'))).toContain('"description"');
  });
});

describe('READ-ONLY: a doctor that repairs is a different, more dangerous tool', () => {
  // sync:worktrees reports drift and refuses to install; deps:reconcile exists
  // so that INVOKING it is the operator deciding. A doctor that silently
  // started Docker, generated an age identity or rewrote git config would be
  // the same violation wearing a helpful face.
  const forbidden = ['age-keygen -o', 'pre-commit install', 'git config --local', 'open -a Docker'];

  it('never executes any remediation it prints', () => {
    const code = cli
      .split(String.fromCharCode(10))
      .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
      .join(String.fromCharCode(10));
    for (const command of forbidden) {
      expect(code.includes(command), command + ' would make the doctor a repairer').toBe(false);
    }
  });

  it('probes liveness with docker info, which pulls nothing and starts nothing', () => {
    expect(cli).toContain("'info'");
  });
});

describe('facts are read where they actually live', () => {
  it('reads the git COMMON dir, since worktrees share one hooks directory', () => {
    expect(cli).toContain('--git-common-dir');
  });

  it('matches recipiency by DERIVED public key, never by hostname', () => {
    expect(cli).toContain('age-keygen');
    expect(
      cli.includes('.age-recipients'),
      'a comment naming a host is prose, and prose doing an assertion job is the defect the roster guard ended',
    ).toBe(true);
  });
});

describe('every capability can be acted on', () => {
  it('has a remediation that names a real command', () => {
    for (const capability of CAPABILITIES) {
      expect(remediationFor(capability.id)).toMatch(/brew|pnpm|Docker/);
    }
  });

  it('points at registered ops, never at raw CLI incantations', () => {
    expect(remediationFor('merge-generated-files')).toContain('turbo run git:merge-drivers');
    expect(remediationFor('commit-safely')).toContain('turbo run bootstrap:machine');
  });
});
