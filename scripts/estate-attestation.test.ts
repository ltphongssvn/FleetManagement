// scripts/estate-attestation.test.ts
// The verdict as an in-toto Statement -- and the boundary where this tool stops.
//
// WHAT THIS BUYS. estate_digest already bound the recommendation to its
// evidence, and --expect-digest already re-checked it. What was missing was a
// shape that TRAVELS: a CI step wanting to sign this verdict would otherwise
// need a translator from our event into an attestation, and a translator is a
// second declaration of the binding, free to drift from the first.
//
// WHAT IT DELIBERATELY DOES NOT BUY. No signature. The DSSE envelope is a
// separate layer and belongs to a runner with an identity worth binding to: a
// local tool signing with a key it holds proves nothing, because signer and
// verifier are the same principal. These tests pin the ABSENCE as firmly as the
// presence -- a future commit adding a local signature should fail here.
import { describe, it, expect } from 'vitest';
import type { EstateDecision } from './estate-verify.js';
import {
  ESTATE_PREDICATE_TYPE,
  ESTATE_SUBJECT_NAME,
  EstateStatementSchema,
  IN_TOTO_STATEMENT_TYPE,
  estateStatement,
} from './estate-attestation.js';
import {
  createWorktreeState,
  decideEstate,
  digestOf,
  estateDigest,
} from './estate-verify.js';

const CLEAN = createWorktreeState({ path: '/c/a', branch: 'x' });
const DIRTY = createWorktreeState({ path: '/c/b', dirtyFileCount: 3 });
const SRC = digestOf('worktree /c/a');

function verified(
  states: readonly ReturnType<typeof createWorktreeState>[],
): EstateDecision {
  return decideEstate({ kind: 'states', states, sourceDigest: SRC });
}

describe('estateStatement: the shape the ecosystem verifies', () => {
  it('declares the in-toto Statement type', () => {
    expect(estateStatement(verified([CLEAN]))?._type).toBe(IN_TOTO_STATEMENT_TYPE);
    expect(IN_TOTO_STATEMENT_TYPE).toBe('https://in-toto.io/Statement/v1');
  });

  it('declares OUR predicate type, versioned separately from the wrapper', () => {
    expect(estateStatement(verified([CLEAN]))?.predicateType).toBe(ESTATE_PREDICATE_TYPE);
    expect(ESTATE_PREDICATE_TYPE).not.toBe(IN_TOTO_STATEMENT_TYPE);
  });

  it('parses against its own schema, so what we emit is what we declare', () => {
    const s = estateStatement(verified([CLEAN, DIRTY]));
    expect(EstateStatementSchema.safeParse(s).success).toBe(true);
  });

  it('survives serialisation, which is what a verifier actually reads', () => {
    const s = estateStatement(verified([DIRTY]));
    expect(EstateStatementSchema.safeParse(JSON.parse(JSON.stringify(s))).success).toBe(true);
  });
});

// THE LOAD-BEARING FIELD. Guidance is explicit that an attestation without a
// subject "cannot be reliably matched to an artifact".
describe('the subject binds the claim to a specific snapshot', () => {
  it('names exactly one subject, since one run observes one estate', () => {
    expect(estateStatement(verified([CLEAN]))?.subject).toHaveLength(1);
  });

  it('carries the estate digest as the subject sha256', () => {
    const s = estateStatement(verified([CLEAN, DIRTY]));
    expect(s?.subject[0]?.digest.sha256).toBe(estateDigest([CLEAN, DIRTY]));
  });

  it('uses a stable subject name, so runs about the same kind of thing match', () => {
    expect(estateStatement(verified([CLEAN]))?.subject[0]?.name).toBe(ESTATE_SUBJECT_NAME);
  });

  it('is sha256, never a weak algorithm a verifier would reject', () => {
    const s = estateStatement(verified([CLEAN]));
    expect(s?.subject[0]?.digest.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(s?.subject[0]?.digest ?? {})).toEqual(['sha256']);
  });

  // Two different estates must never produce the same subject, or the binding
  // matches the wrong snapshot.
  it('distinguishes two different estates', () => {
    const a = estateStatement(verified([CLEAN]));
    const b = estateStatement(verified([CLEAN, DIRTY]));
    expect(a?.subject[0]?.digest.sha256).not.toBe(b?.subject[0]?.digest.sha256);
  });
});

describe('the predicate records the claim, not permission', () => {
  it('carries the recommended action', () => {
    expect(estateStatement(verified([DIRTY]))?.predicate.agent_action)
      .toBe('HALT_WORK_IN_PROGRESS');
  });

  it('carries the verdict and the counts', () => {
    const p = estateStatement(verified([CLEAN, DIRTY]))?.predicate;
    expect(p?.clean).toBe(false);
    expect(p?.checked).toBe(2);
    expect(p?.unclean_count).toBe(1);
  });

  it('reports a clean estate as PROCEED', () => {
    const p = estateStatement(verified([CLEAN]))?.predicate;
    expect(p?.clean).toBe(true);
    expect(p?.agent_action).toBe('PROCEED');
  });

  // Both addresses, so a verifier can tell an estate that moved from a parser
  // that changed underneath it.
  it('carries the source digest beside the subject digest', () => {
    expect(estateStatement(verified([CLEAN]))?.predicate.source_digest).toBe(SRC);
  });
});

// A statement is a CLAIM ABOUT SOMETHING. The other two decisions have nothing
// to make a claim about.
describe('only a verified decision yields a statement', () => {
  it('produces none for an unreadable estate, which has no snapshot to name', () => {
    expect(estateStatement(decideEstate({ kind: 'git-failed' }))).toBeNull();
    expect(estateStatement(decideEstate({ kind: 'no-records', sourceDigest: SRC }))).toBeNull();
    expect(estateStatement(decideEstate({ kind: 'record-rejected', sourceDigest: SRC }))).toBeNull();
  });

  it('produces none for a stale estate, which is a refusal rather than a claim', () => {
    const stale = decideEstate(
      { kind: 'states', states: [CLEAN], sourceDigest: SRC }, null, digestOf('planned'),
    );
    expect(stale.kind).toBe('stale');
    expect(estateStatement(stale)).toBeNull();
  });
});

// ---- the envelope is NOT ours to write ----
// Signing is the DSSE layer. A local tool signing with a key it holds proves
// nothing: signer and verifier are the same principal, so anyone who can run
// the tool can forge the attestation. The 2026 pattern is keyless -- a CI job
// authenticates with OIDC, Fulcio issues a short-lived certificate bound to
// that identity, and the signature is anchored in a transparency log. That
// identity exists in CI, not on a laptop.
describe('the statement is UNSIGNED, and says so by carrying nothing', () => {
  it('carries NO signature, envelope, or key material of any kind', () => {
    const s = estateStatement(verified([CLEAN]));
    const keys = Object.keys(s ?? {});
    expect(keys).toEqual(['_type', 'subject', 'predicateType', 'predicate']);
    for (const forbidden of ['signatures', 'payload', 'payloadType', 'keyid', 'sig', 'cert']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  // strictObject makes this enforceable rather than conventional: a future
  // commit bolting a signature onto the statement fails to parse.
  it('REFUSES a statement that has grown a signature field', () => {
    const s = { ...estateStatement(verified([CLEAN])), signatures: [{ sig: 'x' }] };
    expect(EstateStatementSchema.safeParse(s).success).toBe(false);
  });

  it('leaks no key material into the serialised form', () => {
    const wire = JSON.stringify(estateStatement(verified([CLEAN])));
    expect(wire).not.toContain('AGE-SECRET-KEY');
    expect(wire).not.toContain('BEGIN');
    expect(wire).not.toContain('PRIVATE');
  });
});
