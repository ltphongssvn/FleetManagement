// scripts/env-bootstrap-cli.test.ts
// Contract for the IMPERATIVE SHELL of the env bootstrap. The pure rules live
// in env-bootstrap.ts and are tested there; what is verified HERE is the shell
// orchestration that a pure test cannot reach: preflight ordering, refusal
// conditions, and -- above all -- that no secret material ever crosses argv or
// reaches stdout on a failure path.
//
// WHY EACH REFUSAL EXISTS. Every one is fail-closed, and every one has a
// specific bad outcome it prevents:
//   - missing sops/age binary -> a confusing downstream parse error instead of
//     a nameable "install this" message.
//   - decrypt with no identity file -> sops prompts or hangs in CI.
//   - encrypt when plaintext is absent -> writes an EMPTY encrypted file over a
//     good one, silently destroying every machine's ability to bootstrap.
//   - encrypt with a DUPLICATED key -> writes ciphertext that no recipient can
//     ever decrypt. Observed 2026-08-14: .env carried FLEET_SKIP_ANDROID twice,
//     encryption reported success, and every decrypt failed with "mapping key
//     already defined". dotenv permits repeat assignment; YAML forbids it.
//   - decrypt over an existing .env -> clobbers local edits that were never
//     encrypted, which is data loss the user cannot recover.
//
// NARROWING NOTE. BootstrapDecision is a discriminated union, so every refusal
// assertion narrows on outcome FIRST via expectRefused. Reading .reason off the
// bare union is a type error (caught by //#typecheck:scripts, not by vitest --
// the tests passed while tsc rejected them), and the helper is better than a
// cast: a cast would assert the shape the author expected, while narrowing
// PROVES the outcome really was refused before the reason is read at all.
//
// VOCABULARY NOTE. The reason list is IMPORTED, never re-listed. This file used
// to keep a local ALL_REASONS array mirroring the union in the module -- one
// vocabulary, two declarations -- and adding duplicate_plaintext_keys would
// have left it stale while the three coverage tests below went on passing over
// a set one member short. The frozen as-const array in
// env-bootstrap-vocabulary.ts is now the single definition.
import { describe, it, expect } from 'vitest';
import {
  IDENTITY_ENV_VAR,
  REFUSAL_REASONS,
  REQUIRED_BINARIES,
  type BootstrapDecision,
  type Preconditions,
  type RefusalReason,
  describeRefusal,
  decideBootstrap,
} from './env-bootstrap-cli.js';

const OK_PRECONDITIONS: Preconditions = Object.freeze({
  sopsPresent: true,
  agePresent: true,
  identityFilePresent: true,
  encryptedFilePresent: true,
  plaintextFilePresent: false,
  plaintextHasDuplicateKeys: false,
});

/** Narrow the union and assert the reason. Fails loudly if the decision was
 *  'proceed', so a regression that silently starts allowing a dangerous path
 *  reports as a failed expectation rather than an undefined comparison. */
function expectRefused(decision: BootstrapDecision, reason: RefusalReason): void {
  expect(decision.outcome).toBe('refused');
  if (decision.outcome !== 'refused') return;
  expect(decision.reason).toBe(reason);
}

describe('required tooling', () => {
  it('names both binaries the shell depends on', () => {
    expect(REQUIRED_BINARIES).toContain('sops');
    expect(REQUIRED_BINARIES).toContain('age');
  });

  it('reads the identity from the environment, never from argv', () => {
    expect(IDENTITY_ENV_VAR).toBe('SOPS_AGE_KEY_FILE');
  });
});

describe('decideBootstrap -- decrypt path', () => {
  it('proceeds when every precondition holds', () => {
    expect(decideBootstrap('decrypt', OK_PRECONDITIONS).outcome).toBe('proceed');
  });

  it('refuses when sops is absent', () => {
    expectRefused(
      decideBootstrap('decrypt', { ...OK_PRECONDITIONS, sopsPresent: false }),
      'missing_binary',
    );
  });

  it('refuses when age is absent', () => {
    expectRefused(
      decideBootstrap('decrypt', { ...OK_PRECONDITIONS, agePresent: false }),
      'missing_binary',
    );
  });

  it('refuses when the age identity file is absent', () => {
    expectRefused(
      decideBootstrap('decrypt', { ...OK_PRECONDITIONS, identityFilePresent: false }),
      'missing_identity',
    );
  });

  it('refuses when the encrypted file has not been committed yet', () => {
    expectRefused(
      decideBootstrap('decrypt', { ...OK_PRECONDITIONS, encryptedFilePresent: false }),
      'missing_encrypted',
    );
  });

  it('refuses to clobber an existing plaintext .env', () => {
    expectRefused(
      decideBootstrap('decrypt', { ...OK_PRECONDITIONS, plaintextFilePresent: true }),
      'would_clobber_plaintext',
    );
  });

  it('checks tooling BEFORE file state -- a missing binary dominates', () => {
    expectRefused(
      decideBootstrap('decrypt', {
        ...OK_PRECONDITIONS,
        sopsPresent: false,
        identityFilePresent: false,
        encryptedFilePresent: false,
      }),
      'missing_binary',
    );
  });

  // Duplicates are an ENCRYPT-side rule: on decrypt the ciphertext is the
  // input, and a .env about to be overwritten cannot invalidate it.
  it('ignores duplicate plaintext keys, which are not a decrypt concern', () => {
    const d = decideBootstrap('decrypt', {
      ...OK_PRECONDITIONS,
      plaintextHasDuplicateKeys: true,
    });
    expect(d.outcome).toBe('proceed');
  });
});

describe('decideBootstrap -- encrypt path', () => {
  it('proceeds when plaintext exists and tooling is present', () => {
    const d = decideBootstrap('encrypt', { ...OK_PRECONDITIONS, plaintextFilePresent: true });
    expect(d.outcome).toBe('proceed');
  });

  it('refuses when plaintext is absent rather than writing an empty ciphertext', () => {
    expectRefused(
      decideBootstrap('encrypt', { ...OK_PRECONDITIONS, plaintextFilePresent: false }),
      'missing_plaintext',
    );
  });

  // THE 2026-08-14 DEFECT. Encryption would succeed and produce an artifact
  // that locks out every recipient permanently.
  it('REFUSES when the plaintext assigns a key more than once', () => {
    expectRefused(
      decideBootstrap('encrypt', {
        ...OK_PRECONDITIONS,
        plaintextFilePresent: true,
        plaintextHasDuplicateKeys: true,
      }),
      'duplicate_plaintext_keys',
    );
  });

  // Ordering: a file that does not exist cannot have duplicate keys, so the
  // presence check must dominate or the operator gets the wrong remedy.
  it('reports a MISSING plaintext before a duplicate-key verdict', () => {
    expectRefused(
      decideBootstrap('encrypt', {
        ...OK_PRECONDITIONS,
        plaintextFilePresent: false,
        plaintextHasDuplicateKeys: true,
      }),
      'missing_plaintext',
    );
  });

  it('does NOT require an identity file -- encryption needs only public keys', () => {
    const d = decideBootstrap('encrypt', {
      ...OK_PRECONDITIONS,
      plaintextFilePresent: true,
      identityFilePresent: false,
    });
    expect(d.outcome).toBe('proceed');
  });

  it('does NOT require the ciphertext to pre-exist -- the first encrypt creates it', () => {
    const d = decideBootstrap('encrypt', {
      ...OK_PRECONDITIONS,
      plaintextFilePresent: true,
      encryptedFilePresent: false,
    });
    expect(d.outcome).toBe('proceed');
  });
});

describe('describeRefusal', () => {
  it('covers every reason the vocabulary declares', () => {
    expect(REFUSAL_REASONS.length).toBeGreaterThan(5);
  });

  it('gives an actionable message for every refusal reason', () => {
    for (const reason of REFUSAL_REASONS) {
      const msg = describeRefusal(reason);
      expect(msg.length).toBeGreaterThan(20);
      expect(msg).not.toContain('undefined');
    }
  });

  it('never echoes secret material in any refusal message', () => {
    for (const reason of REFUSAL_REASONS) {
      expect(describeRefusal(reason)).not.toContain('AGE-SECRET-KEY');
    }
  });

  it('gives a DISTINCT message per reason -- no copy-paste collisions', () => {
    const messages = REFUSAL_REASONS.map(describeRefusal);
    expect(new Set(messages).size).toBe(REFUSAL_REASONS.length);
  });

  // The duplicate-key message must state the CONSEQUENCE, or it reads as
  // pedantry and the operator "fixes" it by deleting the wrong line.
  it('explains that a duplicate key yields undecryptable ciphertext', () => {
    const msg = describeRefusal('duplicate_plaintext_keys');
    expect(msg).toContain('decrypt');
    expect(msg).toContain('LAST');
  });
});
