// scripts/env-bootstrap.test.ts
// RED-first contract for the SOPS/age env bootstrap (t105).
//
// ROOT CAUSE THIS CLOSES: there is no reproducible path from a fresh machine to
// a working .env. Every new host required an out-of-band human file copy --
// AirDrop, USB, or chat -- which is the 2026-documented anti-pattern: plaintext
// secrets sitting on N machines, no rotation path, no audit, and no record of
// which host holds which vintage. The repo already blocks .env from git
// (.gitignore:58-60) and scans for leaked credentials (local-secret-guard,
// detect-secrets), but NOTHING produces a .env. Prevention without provisioning
// is why the copy-by-hand habit survived.
//
// The fix is an encrypted .env committed to the repo (SOPS + age): only VALUES
// are encrypted, so field names stay reviewable and diffable, and a new machine
// bootstraps with its age identity plus one command. No plaintext ever lands in
// git, and rotation is one re-encrypt instead of a hunt across three laptops.
//
// Pure core here; the imperative shell (spawning sops) is a thin CLI, matching
// terminal-registry.ts / terminal-registry-cli.ts.
import { describe, it, expect } from 'vitest';
import {
  ENCRYPTED_ENV_FILE,
  PLAINTEXT_ENV_FILE,
  SOPS_CONFIG_FILE,
  decryptArgs,
  encryptArgs,
  parseRecipients,
  renderSopsConfig,
  validateAgeRecipient,
} from './env-bootstrap.js';

const KEY_A = 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p';
const KEY_B = 'age1lggyhqrw2nlhcxprm67z43rta597azn8gknawjehu9d9dl0jq3yqqvfjug';
const NL = String.fromCharCode(10);

describe('file locations', () => {
  it('encrypts to a tracked file distinct from the ignored plaintext', () => {
    expect(PLAINTEXT_ENV_FILE).toBe('.env');
    expect(ENCRYPTED_ENV_FILE).toBe('.env.sops.yaml');
    expect(ENCRYPTED_ENV_FILE).not.toBe(PLAINTEXT_ENV_FILE);
  });

  it('names the sops config at the repo root', () => {
    expect(SOPS_CONFIG_FILE).toBe('.sops.yaml');
  });
});

describe('validateAgeRecipient', () => {
  it('accepts a well-formed age public key', () => {
    expect(validateAgeRecipient(KEY_A)).toBe(true);
  });

  it('rejects an age PRIVATE key -- the secret half must never be a recipient', () => {
    expect(validateAgeRecipient('AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQ')).toBe(false);
  });

  it('rejects an ssh key, empty string and arbitrary text', () => {
    expect(validateAgeRecipient('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5')).toBe(false);
    expect(validateAgeRecipient('')).toBe(false);
    expect(validateAgeRecipient('not-a-key')).toBe(false);
  });
});

describe('parseRecipients', () => {
  it('keeps declaration order and drops blank lines and comments', () => {
    const input = ['# machines', KEY_A, '', '  ' + KEY_B + '  ', ''].join(NL);
    expect(parseRecipients(input)).toEqual([KEY_A, KEY_B]);
  });

  it('throws when any entry is not a valid age recipient -- fail closed', () => {
    const bad = [KEY_A, 'AGE-SECRET-KEY-1BAD'].join(NL);
    expect(() => parseRecipients(bad)).toThrow();
  });

  it('throws on an empty recipient list rather than encrypting to nobody', () => {
    expect(() => parseRecipients('# only a comment')).toThrow();
  });
});

describe('renderSopsConfig', () => {
  it('encrypts every value in the env file for all recipients', () => {
    const yaml = renderSopsConfig([KEY_A, KEY_B]);
    expect(yaml).toContain('creation_rules:');
    expect(yaml).toContain(KEY_A);
    expect(yaml).toContain(KEY_B);
    expect(yaml).toContain(ENCRYPTED_ENV_FILE);
  });

  it('is deterministic -- same recipients render byte-identical config', () => {
    expect(renderSopsConfig([KEY_A])).toBe(renderSopsConfig([KEY_A]));
  });

  it('refuses to render with no recipients', () => {
    expect(() => renderSopsConfig([])).toThrow();
  });
});

describe('encryptArgs / decryptArgs', () => {
  it('encrypt writes the encrypted file, never overwriting plaintext in place', () => {
    const args = encryptArgs();
    expect(args).toContain('--encrypt');
    expect(args).toContain(PLAINTEXT_ENV_FILE);
    expect(args.join(' ')).toContain(ENCRYPTED_ENV_FILE);
  });

  it('decrypt reads the encrypted file and emits dotenv, not yaml', () => {
    const args = decryptArgs();
    expect(args).toContain('--decrypt');
    expect(args).toContain(ENCRYPTED_ENV_FILE);
    expect(args.join(' ')).toContain('dotenv');
  });

  it('never passes a private key on the command line', () => {
    expect(encryptArgs().join(' ')).not.toContain('AGE-SECRET-KEY');
    expect(decryptArgs().join(' ')).not.toContain('AGE-SECRET-KEY');
  });
});
