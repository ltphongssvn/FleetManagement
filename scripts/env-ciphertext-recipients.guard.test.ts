// scripts/env-ciphertext-recipients.guard.test.ts
// THE TRACKED ROSTER MUST MATCH THE TRACKED CIPHERTEXT.
//
// WHAT THIS CLOSES. env-bootstrap-roster.guard.test.ts asserts .sops.yaml is a
// byte-identical render of .age-recipients -- two files, one generator, one
// commit. But the artifact that decides who can actually decrypt is
// .env.sops.yaml, written by a DIFFERENT op (//#env:encrypt) at a different
// time, possibly from a different machine. Nothing compared it to the roster.
//
// So the fail-closed chain had a hole at the end: a machine could be added to
// .age-recipients, rendered into .sops.yaml, pass every existing guard, and
// still be unable to open the ciphertext, because nobody re-encrypted. Both
// .age-recipients and the //#env:encrypt task description warn about this in
// PROSE -- "a recipient list that disagrees with the ciphertext locks somebody
// out silently" -- which is the shape those very files call out elsewhere:
// prose doing an assertion's job.
//
// Observed 2026-08-18: //#doctor reported decrypt-env BROKEN on a machine that
// WAS in the roster, because the commit adding it was unpushed and the
// ciphertext predated it. Diagnosing that took a full search ladder; this guard
// states it in one line.
//
// BOTH DIRECTIONS FAIL, and they are reported separately because the remedies
// differ: a lockout needs a re-encrypt, a stale grant needs a re-encrypt AND a
// credential rotation, since revocation is not retroactive.
//
// NO SECRETS ARE READ. Only the age PUBLIC keys, which are tracked in git on
// purpose -- publishing one grants nothing, and that is the premise of the
// scheme. The guard never decrypts and needs no identity, so it runs on any
// machine including CI.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  describeRecipientDrift,
  recipientDrift,
  recipientsInCiphertext,
  recipientsInRoster,
} from './env-ciphertext-recipients.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(name: string): string {
  return readFileSync(resolve(repoRoot, name), 'utf8');
}

describe('the ciphertext grants exactly what the roster lists', () => {
  const rosterText = read('.age-recipients');
  const cipherText = read('.env.sops.yaml');

  // Vacuity checks first: an empty read on either side would make the
  // comparison below pass while proving nothing -- the confident zero this repo
  // refuses everywhere.
  it('reads at least one recipient from the roster', () => {
    expect(recipientsInRoster(rosterText).length).toBeGreaterThan(0);
  });

  it('reads at least one recipient from the ciphertext', () => {
    expect(recipientsInCiphertext(cipherText).length).toBeGreaterThan(0);
  });

  // THE ASSERTION. Failure prints the drift AND its remedy, because a guard
  // that says only "these disagree" leaves the operator to rediscover which
  // direction and what to run.
  it('has NO drift in either direction', () => {
    const drift = recipientDrift(rosterText, cipherText);
    expect({ drift, remedy: describeRecipientDrift(drift) })
      .toEqual({
        drift: { lockedOut: [], staleGrants: [] },
        remedy: 'roster and ciphertext agree.',
      });
  });

  // The roster is the SSOT and .sops.yaml is generated from it; if the
  // ciphertext matches the roster, it must match the rendered config too. This
  // catches an .env.sops.yaml encrypted against a hand-edited .sops.yaml.
  it('grants the same set the generated .sops.yaml names', () => {
    const rendered = recipientsInRoster(read('.sops.yaml').replaceAll(',', '\n'));
    expect([...recipientsInCiphertext(cipherText)].sort())
      .toEqual([...rendered].sort());
  });
});
