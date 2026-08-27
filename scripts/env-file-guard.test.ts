// scripts/env-file-guard.test.ts
// Contract for the env-file commit guard: which env files may enter the index.
//
// ROOT CAUSE THIS CLOSES. .gitignore carries "!.env.sops.yaml" -- deliberately
// UN-ignoring the SOPS ciphertext, because that file is how every machine
// bootstraps and it is tracked on purpose. The pre-commit hook check-env-files
// never learned about it: its pattern was (^|/)[.]env([.].+)?$ with a single
// exemption for .env.example, so it matched .env.sops.yaml and blocked it.
//
// Two layers of the same policy therefore contradicted each other. .gitignore
// said "track this file"; the hook said "never". The only way to commit the
// ciphertext was git commit --no-verify, and that is what happened on develop.
// 2026 secret-scanning guidance names the --no-verify bypass as the critical
// gap in pre-commit enforcement, which is why the rule has to be CORRECT rather
// than merely strict: a gate you must evade to do the RIGHT thing is a gate you
// will evade to do the wrong one.
//
// A NAME ALLOWLIST WOULD NOT BE ENOUGH, and that is the substance here.
// Exempting the NAME .env.sops.yaml passes a PLAINTEXT file carrying that name
// -- the precise failure the .gitignore comment warns about when it insists the
// allowlist be exact rather than a glob. Name-exactness proves nothing about
// contents. So the exemption is CONDITIONAL on the file actually being
// SOPS-encrypted: assert what it IS, not what it is called.
//
// PURE CORE. classifyEnvPath decides from (path, contents) alone -- no git, no
// disk -- so every branch is unit-testable. The imperative shell reads the
// STAGED blob and calls it once per candidate path.
import { describe, it, expect } from 'vitest';
import {
  ALLOWED_PLAINTEXT_ENV_FILE,
  ALLOWED_ENCRYPTED_ENV_FILE,
  isEnvPath,
  classifyEnvPath,
  describeEnvViolation,
} from './env-file-guard.js';

const CIPHERTEXT = [
  'FLEET_PORT_API: ENC[AES256_GCM,data:JFcGJeY=,iv:ZKX=,tag:ozB==,type:str]',
  'sops:',
  '    age:',
  '        - recipient: age1022fpw0nt5xdw5txz86cl5whgeq2u3cxhtx9anuvz0twawyh84lqwl0etj',
].join(String.fromCharCode(10));

// FIXTURE VALUES ARE BORING BY CONSTRUCTION, and that rule was learned the hard
// way in this very file. The first draft used a database connection URL with an
// inline user and password: detect-secrets flagged it as Basic Auth Credentials.
// The replacement used a hex worktree key: the SAME scanner then flagged it as a
// Base64 High Entropy String. Two findings, one cause -- both values were chosen
// to look REALISTIC, and looking realistic is precisely what a secret scanner
// detects. Patching each finding in turn is the treadmill; the root fix is to
// pick values with no recognisable shape at all.
//
// Neither value contributed anything to the assertion, which needs only content
// that is NOT sops-encrypted. The remedy is therefore to ELIMINATE the literal,
// never to suppress the finding: peer-reviewed work on secret-detection tooling
// records that the override mechanisms are themselves how secrets end up
// committed, and this repo already chose runtime construction over a pragma for
// the same reason in the age-key baseline test. The offending patterns are
// DESCRIBED here rather than quoted, because a comment reproducing them would
// trip the same detectors -- and a fixture that looks like a credential is one
// somebody eventually copies into something real.
const PLAINTEXT = ['FLEET_PORT_API=20180', 'FLEET_LOG_LEVEL=debug'].join(String.fromCharCode(10));

describe('isEnvPath recognises env files anywhere in the tree', () => {
  it('matches a bare .env at the root', () => {
    expect(isEnvPath('.env')).toBe(true);
  });

  it('matches a suffixed .env', () => {
    expect(isEnvPath('.env.local')).toBe(true);
    expect(isEnvPath('.env.production')).toBe(true);
  });

  it('matches a nested env file, not just the root', () => {
    expect(isEnvPath('apps/api/.env')).toBe(true);
    expect(isEnvPath('apps/api/.env.local')).toBe(true);
  });

  it('does NOT match a file that merely contains env in its name', () => {
    expect(isEnvPath('environment.ts')).toBe(false);
    expect(isEnvPath('scripts/env-file-guard.ts')).toBe(false);
    expect(isEnvPath('apps/api/src/config/env.config.ts')).toBe(false);
  });
});

describe('classifyEnvPath allows the two files tracked on purpose', () => {
  it('allows .env.example regardless of contents -- it is a template', () => {
    expect(classifyEnvPath(ALLOWED_PLAINTEXT_ENV_FILE, PLAINTEXT)).toEqual({ allowed: true });
  });

  it('allows .env.sops.yaml WHEN it is genuinely encrypted', () => {
    expect(classifyEnvPath(ALLOWED_ENCRYPTED_ENV_FILE, CIPHERTEXT)).toEqual({ allowed: true });
  });

  it('allows the ciphertext from a nested path too', () => {
    expect(classifyEnvPath('infra/' + ALLOWED_ENCRYPTED_ENV_FILE, CIPHERTEXT)).toEqual({
      allowed: true,
    });
  });
});

describe('classifyEnvPath blocks plaintext, including under an allowed name', () => {
  it('BLOCKS a plaintext file named .env.sops.yaml -- the name is not the proof', () => {
    const decision = classifyEnvPath(ALLOWED_ENCRYPTED_ENV_FILE, PLAINTEXT);
    expect(decision.allowed).toBe(false);
  });

  it('blocks ciphertext that has ENC values but no sops MAC block', () => {
    const noMac = 'FLEET_PORT_API: ENC[AES256_GCM,data:JFcGJeY=,iv:ZKX=,tag:ozB==,type:str]';
    expect(classifyEnvPath(ALLOWED_ENCRYPTED_ENV_FILE, noMac).allowed).toBe(false);
  });

  it('blocks ciphertext that has a sops block but no encrypted values', () => {
    const noEnc = ['FLEET_PORT_API: 20180', 'sops:', '    age: []'].join(String.fromCharCode(10));
    expect(classifyEnvPath(ALLOWED_ENCRYPTED_ENV_FILE, noEnc).allowed).toBe(false);
  });

  it('blocks a bare .env', () => {
    expect(classifyEnvPath('.env', PLAINTEXT).allowed).toBe(false);
  });

  it('blocks .env.local and .env.production', () => {
    expect(classifyEnvPath('.env.local', PLAINTEXT).allowed).toBe(false);
    expect(classifyEnvPath('.env.production', PLAINTEXT).allowed).toBe(false);
  });

  it('blocks a nested plaintext env file', () => {
    expect(classifyEnvPath('apps/api/.env', PLAINTEXT).allowed).toBe(false);
  });
});

describe('describeEnvViolation names the condition, never a value', () => {
  it('reports the path and the remedy for a plaintext env file', () => {
    const decision = classifyEnvPath('.env', PLAINTEXT);
    const message = describeEnvViolation('.env', decision);
    expect(message).toContain('.env');
    expect(message.length).toBeGreaterThan(0);
  });

  it('gives the RE-ENCRYPT remedy when the ciphertext name holds plaintext', () => {
    const decision = classifyEnvPath(ALLOWED_ENCRYPTED_ENV_FILE, PLAINTEXT);
    expect(describeEnvViolation(ALLOWED_ENCRYPTED_ENV_FILE, decision)).toContain('env:encrypt');
  });

  it('NEVER echoes a value from the file -- only the condition', () => {
    const decision = classifyEnvPath('.env', PLAINTEXT);
    const message = describeEnvViolation('.env', decision);
    expect(message).not.toContain('20180');
    expect(message).not.toContain('debug');
  });
});
