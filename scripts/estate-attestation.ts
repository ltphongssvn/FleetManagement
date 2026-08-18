// scripts/estate-attestation.ts
// The verdict as an in-toto STATEMENT: a claim bound to the exact snapshot it
// was computed from, in the shape the ecosystem already verifies.
//
// WHY A STANDARD SHAPE. estate_digest already binds the recommendation to its
// evidence, and --expect-digest already re-checks that binding. What the events
// could not do is travel: a CI step wanting to sign this verdict would need a
// translator from our bespoke event into an attestation, and that translator
// would be a SECOND declaration of the binding -- free to drift from the first.
// The in-toto Statement is the ecosystem's serialisation of exactly this claim,
// so rendering it directly removes the translator rather than adding one.
//
// The subject is the load-bearing part. 2026 guidance: subjects are "artifact
// references, each identified by a name and a set of cryptographic digests",
// and an attestation without one "cannot be reliably matched to an artifact".
// Our artifact is not a file -- it is the ESTATE SNAPSHOT -- and estateDigest
// is already its sha256 content address, so it drops straight into the subject.
//
// UNSIGNED BY DESIGN, and this is the whole reason the module stops here.
// Signing is the DSSE envelope, a SEPARATE layer, and a local tool signing with
// a key it holds proves nothing: signer and verifier are the same principal, so
// anyone who can run the tool can forge the attestation. The 2026 pattern is
// keyless -- a CI job authenticates with an OIDC token, Fulcio issues a
// short-lived certificate bound to that identity, and the signature is anchored
// in a transparency log. That identity exists in CI and not on a laptop.
//
// Cosign's own tooling assumes this split: a scanner emits an unsigned
// statement and a later step signs it. So this module produces the statement,
// names nothing as signed, and leaves the envelope to a runner that has an
// identity worth binding to.
import { z } from 'zod';
import { ESTATE_ACTIONS } from './estate-action.js';
import type { EstateDecision } from './estate-verify.js';

/** The in-toto Statement type URI. v1 is current; the version is part of the
 *  contract, so it is a literal rather than a loose string. */
export const IN_TOTO_STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';

/** OUR predicate type. A URI under a namespace we control, versioned
 *  independently of the statement wrapper, because the two evolve separately:
 *  in-toto may reach v2 while this predicate stays v1, and vice versa. */
export const ESTATE_PREDICATE_TYPE = 'https://fleet.internal/attestation/estate-verify/v1';

/** The subject NAME. Not a file path: the artifact being attested is the estate
 *  snapshot itself, which has no path. A stable name lets a verifier match
 *  statements about the same KIND of subject across runs. */
export const ESTATE_SUBJECT_NAME = 'fleet-worktree-estate';

/** An in-toto Statement over one estate snapshot.
 *
 *  strictObject: this is a published wire shape we construct, so an
 *  unrecognised key is our own typo, the same argument the event schemas make.
 *  The digest map is deliberately sha256-only -- guidance calls out weak
 *  algorithms (MD5, SHA-1) as unmatchable, and offering a choice we never use
 *  would be a field a verifier has to branch on for nothing. */
export const EstateStatementSchema = z.strictObject({
  _type: z.literal(IN_TOTO_STATEMENT_TYPE),
  subject: z.array(z.strictObject({
    name: z.literal(ESTATE_SUBJECT_NAME),
    digest: z.strictObject({ sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  })).readonly(),
  predicateType: z.literal(ESTATE_PREDICATE_TYPE),
  predicate: z.strictObject({
    /** What the tool recommends. ADVISORY: a statement records a claim, it does
     *  not confer permission, and no field a tool emits is self-authorizing. */
    agent_action: z.enum(ESTATE_ACTIONS),
    clean: z.boolean(),
    checked: z.number().int().nonnegative(),
    unclean_count: z.number().int().nonnegative(),
    /** The RAW porcelain address, when there was one. Present alongside the
     *  subject digest so a verifier can tell an estate that moved from a parser
     *  that changed -- same source, different snapshot means the CODE moved. */
    source_digest: z.string().optional(),
  }),
});
export type EstateStatement = z.infer<typeof EstateStatementSchema>;

/** Render a VERIFIED decision as an in-toto Statement.
 *
 *  Only the verified arm produces one, and that is the point rather than a
 *  limitation: an unreadable estate has no snapshot to name as a subject, and a
 *  stale one is a refusal rather than a claim. An attestation over an estate
 *  nobody could read would be a signature on an empty assertion -- exactly the
 *  "attestation without a subject" the guidance calls unmatchable.
 *
 *  Returns null rather than throwing, so a caller renders a statement when one
 *  exists and carries on when it does not. */
export function estateStatement(decision: EstateDecision): EstateStatement | null {
  if (decision.kind !== 'verified') return null;
  const { event, verdict } = decision;
  return {
    _type: IN_TOTO_STATEMENT_TYPE,
    subject: [{
      name: ESTATE_SUBJECT_NAME,
      digest: { sha256: event.estate_digest },
    }],
    predicateType: ESTATE_PREDICATE_TYPE,
    predicate: {
      agent_action: event.agent_action,
      clean: verdict.clean,
      checked: verdict.checked,
      unclean_count: verdict.problems.length,
      ...(event.source_digest === undefined
        ? {}
        : { source_digest: event.source_digest }),
    },
  };
}
