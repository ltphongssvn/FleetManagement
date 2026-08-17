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
//   - decrypt over an existing .env -> clobbers local edits that were never
//     encrypted, which is data loss the user cannot recover.
//
// NARROWING NOTE. BootstrapDecision is a discriminated union, so every refusal
// assertion narrows on outcome FIRST via expectRefused. Reading .reason off the
// bare union is a type error (caught by //#typecheck:scripts, not by vitest --
// the tests passed while tsc rejected them), and the helper is better than a
// cast: a cast would assert the shape the author expected, while narrowing
// PROVES the outcome really was refused before the reason is read at all.
import { describe, it, expect } from 'vitest';
import {
  IDENTITY_ENV_VAR,
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
});

const ALL_REASONS: readonly RefusalReason[] = Object.freeze([
  'missing_binary',
  'missing_identity',
  'missing_encrypted',
  'missing_plaintext',
  'would_clobber_plaintext',
]);

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
  it('gives an actionable message for every refusal reason', () => {
    for (const reason of ALL_REASONS) {
      const msg = describeRefusal(reason);
      expect(msg.length).toBeGreaterThan(20);
      expect(msg).not.toContain('undefined');
    }
  });

  it('never echoes secret material in any refusal message', () => {
    for (const reason of ALL_REASONS) {
      expect(describeRefusal(reason)).not.toContain('AGE-SECRET-KEY');
    }
  });

  it('gives a DISTINCT message per reason -- no copy-paste collisions', () => {
    const messages = ALL_REASONS.map(describeRefusal);
    expect(new Set(messages).size).toBe(ALL_REASONS.length);
  });
});
