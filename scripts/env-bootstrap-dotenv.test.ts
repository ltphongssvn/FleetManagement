// scripts/env-bootstrap-dotenv.test.ts
// The one rule that decides whether an encrypt produces a readable artifact or
// a corpse.
//
// THE OBSERVED FAILURE, 2026-08-14. This machine's .env carried
// FLEET_SKIP_ANDROID twice. env:encrypt reported success; every subsequent
// decrypt -- on every machine, for every recipient -- failed with
//   yaml: unmarshal errors:
//     line 16: mapping key "FLEET_SKIP_ANDROID" already defined at line 15
// dotenv permits duplicate assignment and YAML forbids it, so the file was
// legal going in and illegal coming out, and nothing between the two noticed.
//
// These tests pin the detector rather than the symptom: the duplicate is found
// BEFORE sops runs, so the unreadable file is never written in the first place.
import { describe, it, expect } from 'vitest';
import { findDuplicateKeys, describeDuplicates } from './env-bootstrap-dotenv.js';

const NL = String.fromCharCode(10);

function env(...lines: readonly string[]): string {
  return lines.join(NL);
}

describe('findDuplicateKeys', () => {
  it('finds nothing in a well-formed file', () => {
    expect(findDuplicateKeys(env('A=1', 'B=2', 'C=3'))).toEqual([]);
  });

  it('finds nothing in an empty file', () => {
    expect(findDuplicateKeys('')).toEqual([]);
  });

  // The exact shape that produced the unreadable artifact.
  it('catches the FLEET_SKIP_ANDROID duplicate that broke the round trip', () => {
    const found = findDuplicateKeys(
      env('DOCKER_DEFAULT_PLATFORM=linux/amd64', 'FLEET_SKIP_ANDROID=1', 'FLEET_SKIP_ANDROID=1'),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.key).toBe('FLEET_SKIP_ANDROID');
  });

  it('reports every line the key was assigned on, 1-based', () => {
    const found = findDuplicateKeys(env('A=1', 'B=2', 'A=3'));
    expect(found[0]?.lines).toEqual([1, 3]);
  });

  it('reports a key assigned three times with all three lines', () => {
    const found = findDuplicateKeys(env('A=1', 'A=2', 'A=3'));
    expect(found[0]?.lines).toEqual([1, 2, 3]);
  });

  it('reports several duplicated keys in first-appearance order', () => {
    const found = findDuplicateKeys(env('B=1', 'A=1', 'B=2', 'A=2'));
    expect(found.map((d) => d.key)).toEqual(['B', 'A']);
  });

  // A different VALUE is still a duplicate KEY: YAML rejects on the key alone,
  // so equal values would not make the file readable.
  it('flags a repeat even when the values differ', () => {
    expect(findDuplicateKeys(env('A=1', 'A=2'))).toHaveLength(1);
  });

  it('ignores comments, so a commented-out assignment is not a duplicate', () => {
    expect(findDuplicateKeys(env('A=1', '# A=2'))).toEqual([]);
  });

  it('ignores blank lines and indentation', () => {
    expect(findDuplicateKeys(env('A=1', '', '   ', 'B=2'))).toEqual([]);
  });

  // export FOO=1 and FOO=1 assign the SAME variable, so treating them as
  // distinct keys would miss a real duplicate.
  it('treats an export prefix as the same key', () => {
    const found = findDuplicateKeys(env('FOO=1', 'export FOO=2'));
    expect(found).toHaveLength(1);
    expect(found[0]?.key).toBe('FOO');
  });

  it('ignores a line that assigns nothing', () => {
    expect(findDuplicateKeys(env('A=1', 'not an assignment', 'A=2'))).toHaveLength(1);
  });

  it('ignores a line beginning with = and no key', () => {
    expect(findDuplicateKeys(env('=orphan', '=orphan'))).toEqual([]);
  });

  it('tolerates a value that itself contains an equals sign', () => {
    expect(findDuplicateKeys(env('URL=a=b', 'URL=c=d'))[0]?.key).toBe('URL');
  });

  it('is case sensitive, as the shell is', () => {
    expect(findDuplicateKeys(env('Path=1', 'PATH=2'))).toEqual([]);
  });
});

describe('describeDuplicates', () => {
  it('names the key and its lines', () => {
    const message = describeDuplicates(findDuplicateKeys(env('A=1', 'A=2')));
    expect(message).toContain('A');
    expect(message).toContain('1, 2');
  });

  // The message has to state the CONSEQUENCE: "duplicate key" reads as
  // pedantry until the operator knows it yields ciphertext nobody can open.
  it('states that the artifact would be undecryptable, not merely invalid', () => {
    const message = describeDuplicates(findDuplicateKeys(env('A=1', 'A=2')));
    expect(message).toContain('decrypt');
    expect(message).toContain('refusing to encrypt');
  });

  it('points at the upstream issue so the rule can be verified', () => {
    const message = describeDuplicates(findDuplicateKeys(env('A=1', 'A=2')));
    expect(message).toContain('851');
  });

  it('tells the operator which assignment dotenv keeps', () => {
    const message = describeDuplicates(findDuplicateKeys(env('A=1', 'A=2')));
    expect(message).toContain('LAST');
  });
});
