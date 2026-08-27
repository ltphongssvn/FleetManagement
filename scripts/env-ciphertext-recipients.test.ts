// scripts/env-ciphertext-recipients.test.ts
// The two ways a roster and a ciphertext disagree, and why they are not one bug.
//
// Keys here are SYNTHETIC: valid age PUBLIC shape (age1 + 58 bech32 chars),
// generated from the charset rather than copied from the real roster, so this
// file grants nothing and mints no baseline finding. Public keys are published
// by design, but a test fixture has no reason to carry a real one.
import { describe, it, expect } from 'vitest';
import {
  describeRecipientDrift,
  recipientDrift,
  recipientsInCiphertext,
  recipientsInRoster,
} from './env-ciphertext-recipients.js';

const NL = String.fromCharCode(10);

/** A syntactically valid age public key built from a repeated bech32 char, so
 *  no real recipient appears in this file. */
function key(c: string): string {
  return 'age1' + c.repeat(58);
}

const A = key('q');
const B = key('p');
const C = key('z');

function ciphertextFor(recipients: readonly string[]): string {
  return [
    'FLEET_PORT_API: ENC[AES256_GCM,data:xxxx,type:str]',
    'sops:',
    '    age:',
    ...recipients.flatMap((r) => [
      '        - enc: |',
      '            -----BEGIN AGE ENCRYPTED FILE-----',
      '            c29tZSBiYXNlNjQgcGF5bG9hZA==',
      '            -----END AGE ENCRYPTED FILE-----',
      '          recipient: ' + r,
    ]),
    '    version: 3.13.3',
  ].join(NL);
}

function roster(recipients: readonly string[]): string {
  return [
    '# .age-recipients',
    '# One age PUBLIC key per line.',
    '',
    '# MacBook01TBsMBP',
    ...recipients,
  ].join(NL);
}

describe('recipientsInCiphertext', () => {
  it('reads every granted key from the sops.age block', () => {
    expect(recipientsInCiphertext(ciphertextFor([A, B, C]))).toEqual([A, B, C]);
  });

  // The ENC[...] payload lines are base64 and contain no age1 prefix; a reader
  // matching too loosely would report phantom recipients.
  it('reads NOTHING from the encrypted values themselves', () => {
    expect(recipientsInCiphertext('FOO: ENC[AES256_GCM,data:age1notakey,type:str]')).toEqual([]);
  });

  it('reads nothing from a ciphertext with no age block', () => {
    expect(recipientsInCiphertext('sops:' + NL + '    version: 3.13.3')).toEqual([]);
  });
});

describe('recipientsInRoster', () => {
  it('reads the keys and ignores comments and blanks', () => {
    expect(recipientsInRoster(roster([A, B]))).toEqual([A, B]);
  });

  // The same anchored shape used everywhere in this arc: an age PRIVATE key
  // pasted into the roster by mistake must never be read as a grant.
  it('REFUSES an AGE-SECRET-KEY line', () => {
    expect(recipientsInRoster('AGE-SECRET-KEY-1QQQQQQ')).toEqual([]);
  });

  it('refuses a short age-prefixed string', () => {
    expect(recipientsInRoster('age1tooshort')).toEqual([]);
  });
});

describe('recipientDrift: agreement', () => {
  it('reports NO drift when both sides carry the same keys', () => {
    expect(recipientDrift(roster([A, B]), ciphertextFor([A, B]))).toEqual({
      lockedOut: [],
      staleGrants: [],
    });
  });

  // Order is an artifact of how each file was written, never a difference.
  it('ignores ORDER, which differs between the two files by construction', () => {
    expect(recipientDrift(roster([A, B]), ciphertextFor([B, A]))).toEqual({
      lockedOut: [],
      staleGrants: [],
    });
  });
});

describe('recipientDrift: the lockout', () => {
  // THE OBSERVED FAILURE, 2026-08-18: this machine was in the roster on an
  // unpushed branch while the ciphertext predated it, and doctor reported
  // decrypt-env BROKEN with no check able to state why.
  it('names a machine granted in the roster that CANNOT decrypt', () => {
    expect(recipientDrift(roster([A, B, C]), ciphertextFor([A, B]))).toEqual({
      lockedOut: [C],
      staleGrants: [],
    });
  });

  it('names the remedy: re-encrypt from a machine holding the plaintext', () => {
    const message = describeRecipientDrift(recipientDrift(roster([A, C]), ciphertextFor([A])));
    expect(message).toContain('LOCKED OUT');
    expect(message).toContain('env:encrypt');
  });
});

describe('recipientDrift: the stale grant', () => {
  // The opposite direction, and a DIFFERENT finding: a revoked machine can
  // still open the current blob. Reporting it as a lockout would send the
  // operator to the wrong remedy.
  it('names a key that can decrypt but is no longer in the roster', () => {
    expect(recipientDrift(roster([A]), ciphertextFor([A, B]))).toEqual({
      lockedOut: [],
      staleGrants: [B],
    });
  });

  // .age-recipients states this explicitly: revocation is not retroactive, so
  // removing a line without rotating is theatre.
  it('names ROTATION as part of the remedy, not just re-encryption', () => {
    const message = describeRecipientDrift(recipientDrift(roster([A]), ciphertextFor([A, B])));
    expect(message).toContain('STALE GRANT');
    expect(message).toContain('rotat');
  });

  it('reports BOTH directions at once when both are present', () => {
    expect(recipientDrift(roster([A, C]), ciphertextFor([A, B]))).toEqual({
      lockedOut: [C],
      staleGrants: [B],
    });
  });

  it('says so plainly when there is nothing to report', () => {
    expect(describeRecipientDrift({ lockedOut: [], staleGrants: [] })).toContain('agree');
  });
});
