// scripts/env-ciphertext-recipients.ts
// DOES THE ROSTER MATCH THE CIPHERTEXT? Nothing could answer this.
//
// THE GAP. .age-recipients is the human-edited SSOT, .sops.yaml is GENERATED
// from it by //#env:recipients, and env-bootstrap-roster.guard.test.ts asserts
// those two agree byte for byte. But .env.sops.yaml -- the artifact that
// actually decides who can decrypt -- is written by a SEPARATE op, //#env:encrypt,
// run at a different time, possibly from a different machine.
//
// So a machine can be listed in the roster, rendered into .sops.yaml, pass every
// guard, and still be unable to decrypt: the ciphertext was encrypted before it
// was added. .age-recipients says so in its own header -- "a recipient list that
// disagrees with the ciphertext locks somebody out silently" -- and env:encrypt's
// task description repeats it. Both state the hazard as PROSE addressed to
// whoever remembers to re-encrypt. Prose doing an assertion's job is the exact
// defect the roster guard was written to end, one file downstream.
//
// It is not hypothetical. On 2026-08-18 //#doctor reported decrypt-env BROKEN on
// this machine while the commit adding it as a recipient sat unpushed; the
// diagnosis took a full ladder walk because no check could state the fact
// directly.
//
// THE ASYMMETRY IS DELIBERATE. Roster-not-in-ciphertext is a LOCKOUT: a machine
// the team believes has access does not. Ciphertext-not-in-roster is a STALE
// GRANT: a revoked machine can still open the current blob, which is a real
// finding and a different one -- .age-recipients records that revocation is not
// retroactive and must be followed by rotating the credentials. The two are
// reported separately so a fix addresses the right one.
//
// PURE, taking file TEXT rather than paths, so both directions are exercised
// without sops, without an age identity, and without a filesystem.

/** Every recipient the SOPS ciphertext can be opened by.
 *
 *  Read from the `recipient:` keys under sops.age, which sops writes one per
 *  granted key. Matched by the age PUBLIC key shape rather than by YAML nesting:
 *  the block is machine-generated with a stable prefix, and a structural parse
 *  would add a YAML dependency to a guard that needs one field. */
export function recipientsInCiphertext(text: string): readonly string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = /recipient:\s*(age1[02-9ac-hj-np-z]{58})\s*$/.exec(line);
    const found = m?.[1];
    if (found !== undefined) out.push(found);
  }
  return out;
}

/** Every recipient the roster grants.
 *
 *  Comments and blank lines are ignored, matching parseRecipientEntries. The
 *  same anchored age1 + 58-bech32 shape as everywhere else in this arc, so an
 *  AGE-SECRET-KEY pasted here by mistake is not read as a grant. */
export function recipientsInRoster(text: string): readonly string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const m = /^(age1[02-9ac-hj-np-z]{58})$/.exec(line);
    const found = m?.[1];
    if (found !== undefined) out.push(found);
  }
  return out;
}

/** The two ways the roster and the ciphertext can disagree, kept apart because
 *  the remedies differ: a lockout needs //#env:encrypt from a machine holding
 *  the plaintext, a stale grant needs a re-encrypt AND a credential rotation. */
export interface RecipientDrift {
  /** Granted by the roster, cannot open the ciphertext. A LOCKOUT. */
  readonly lockedOut: readonly string[];
  /** Can open the ciphertext, absent from the roster. A STALE GRANT. */
  readonly staleGrants: readonly string[];
}

export function recipientDrift(
  rosterText: string,
  ciphertextText: string,
): RecipientDrift {
  const roster = recipientsInRoster(rosterText);
  const cipher = recipientsInCiphertext(ciphertextText);
  const inCipher = new Set(cipher);
  const inRoster = new Set(roster);
  return {
    lockedOut: roster.filter((r) => !inCipher.has(r)),
    staleGrants: cipher.filter((r) => !inRoster.has(r)),
  };
}

/** An operator sentence naming the drift and its remedy. Codes are for the
 *  caller to branch on; this is what a person reads when the guard fails, and a
 *  failure that does not name the remedy is a stall. */
export function describeRecipientDrift(drift: RecipientDrift): string {
  const nl = String.fromCharCode(10);
  const parts: string[] = [];
  if (drift.lockedOut.length > 0) {
    parts.push(
      'LOCKED OUT (' + String(drift.lockedOut.length) + '): granted in '
      + '.age-recipients but CANNOT decrypt .env.sops.yaml. Re-encrypt from a '
      + 'machine holding the plaintext: pnpm exec turbo run env:encrypt, then '
      + 'commit .env.sops.yaml with the roster.',
    );
  }
  if (drift.staleGrants.length > 0) {
    parts.push(
      'STALE GRANT (' + String(drift.staleGrants.length) + '): CAN decrypt '
      + '.env.sops.yaml but is absent from .age-recipients. Revocation is not '
      + 'retroactive -- re-encrypt AND rotate the underlying credentials.',
    );
  }
  return parts.length === 0 ? 'roster and ciphertext agree.' : parts.join(nl);
}
