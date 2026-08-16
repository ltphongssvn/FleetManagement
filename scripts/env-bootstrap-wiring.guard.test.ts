// scripts/env-bootstrap-wiring.guard.test.ts
// ARCHITECTURAL GUARD: assert the env bootstrap stays wired and stays safe.
//
// Every other test in this arc checks BEHAVIOUR. This one checks that the
// behaviour remains REACHABLE and that its safety properties cannot be edited
// away quietly. The repo has the same shape of guard in
// ci-fast-covers-test-scripts, worktree-sweep-registered and
// turbo-version-floor: an executable architectural constraint, so a future edit
// that breaks the wiring fails a test instead of failing silently in six weeks.
//
// WHY THIS PARTICULAR ARC NEEDS ONE. The failure it protects against is not
// hypothetical -- it is the exact history of the code under it. Three defects
// shipped in three lines of one function (unescaped dots, unquoted YAML, the
// rule targeting the wrong file), and each was invisible to the instrument that
// caught the previous one. A fourth is likelier than not. More to the point,
// terminal-registry.ts sat COMPLETE AND UNIT-TESTED for months while no task
// called it, so every claim was still hand-typed -- correct code nobody could
// reach. Tests passing is not the same as the op existing.
//
// These assertions read SOURCE TEXT rather than importing, deliberately: the
// point is to catch an edit to the file, and importing would happily succeed
// against a file whose safety comments and env-var handling had been rewritten.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf-8');
}

interface RootManifest {
  readonly scripts?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

const manifest = JSON.parse(read('package.json')) as RootManifest;
const turbo = read('turbo.jsonc');
const cli = read('scripts/env-bootstrap-cli.ts');
const core = read('scripts/env-bootstrap.ts');
const ignore = read('.gitignore');

describe('the three ops are registered, not ad-hoc CLI', () => {
  it('every env op is a committed root script', () => {
    for (const name of ['env:decrypt', 'env:encrypt', 'env:recipients']) {
      expect(manifest.scripts?.[name]).toBeDefined();
    }
  });

  it('every env op is also a root-scoped turbo task', () => {
    for (const name of ['env:decrypt', 'env:encrypt', 'env:recipients']) {
      expect(turbo).toContain('"//#' + name + '"');
    }
  });

  it('each task carries a description -- the SSOT this repo documents in', () => {
    const block = turbo.slice(turbo.indexOf('"//#env:decrypt"'));
    expect(block).toContain('"description"');
  });

  it('the yaml parser used by the config tests is a declared dependency', () => {
    expect(manifest.devDependencies?.['yaml']).toBeDefined();
  });
});

describe('secret-handling invariants cannot be edited away silently', () => {
  it('the CLI never writes to stdout -- plaintext must not reach scrollback', () => {
    expect(cli).not.toContain('process.stdout.write');
  });

  it('the identity travels in the environment, never in argv', () => {
    expect(cli).toContain('SOPS_AGE_KEY_FILE');
    expect(core).not.toContain('--age-key-file');
    expect(core).not.toContain('--identity-file');
  });

  it('the decrypted file is written mode 600', () => {
    expect(cli).toContain('0o600');
  });

  it('every throw passes through the single formatter', () => {
    expect(cli).toContain('formatCliError');
  });

  it('encryption writes a separate output, never in place', () => {
    expect(core).toContain('--output');
  });
});

describe('gitignore keeps the right side of the line', () => {
  it('blocks the plaintext env file', () => {
    expect(ignore).toMatch(/^\.env$/m);
  });

  it('allowlists the ciphertext by EXACT name, never a glob', () => {
    expect(ignore).toMatch(/^!\.env\.sops\.yaml$/m);
    expect(ignore).not.toMatch(/^!\.env\.\*/m);
  });

  it('blocks age private identities as defense in depth', () => {
    expect(ignore).toMatch(/^keys\.txt$/m);
  });
});

describe('the runbook exists and is discoverable', () => {
  it('documents all three ops', () => {
    const doc = read('docs/ENV-BOOTSTRAP.md');
    expect(doc).toContain('env:decrypt');
    expect(doc).toContain('env:encrypt');
    expect(doc).toContain('env:recipients');
  });

  it('states that revocation requires rotation', () => {
    expect(read('docs/ENV-BOOTSTRAP.md').toLowerCase()).toContain('rotate');
  });

  it('carries no key material of any kind', () => {
    const doc = read('docs/ENV-BOOTSTRAP.md');
    expect(doc).not.toContain('AGE-SECRET-KEY');
    expect(doc).not.toMatch(/age1[02-9ac-hj-np-z]{58}/);
  });
});
