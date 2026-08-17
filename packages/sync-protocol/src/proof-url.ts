// packages/sync-protocol/src/proof-url.ts
// SSOT for what a Phieu Can PROOF URL is allowed to be.
//
// ROOT CAUSE THIS CLOSES. StopProofSchema declared photoUrl as a bare z.url().
// Zod documents that as "quite permissive": it delegates to the native URL
// constructor, so mailto:, data:, file: and -- critically -- javascript: are all
// valid URLs and all parsed successfully. Verified against zod 4.4.3 in this
// repo, not assumed from the docs: a RED test asserting rejection failed on
// every one of them.
//
// That value is not decorative. ops-web renders it straight into an anchor:
//   apps/ops-web/src/features/dispatch/board-stops.tsx
//   <a href={proof.photoUrl} target='_blank' rel='noopener noreferrer'>
// so a javascript: or data: URL reaching that attribute is stored XSS. The
// existing rel='noopener noreferrer' guards tab-nabbing, a DIFFERENT attack; it
// does nothing about the scheme.
//
// WHERE THE BOUNDARY ACTUALLY IS. The API mints this URL from a presigner, so
// server-side it is trusted-internal. ops-web PARSES it off the network, and
// that is the trust boundary -- only the parse can protect the href. No
// attacker-controlled S3 is required for this to bite: a buggy mint, a test
// double, or a future refactor emitting a raw string is enough.
//
// ALLOWLIST, NEVER DENYLIST. Enumerating known-bad schemes is a treadmill that
// the next scheme defeats. http and https are the only schemes S3 or LocalStack
// ever serve, so everything else is rejected by construction.
//
// WHY NOT z.httpUrl(). It looks purpose-built and is the wrong tool here: its
// hostname regex demands a conventional domain, so it REJECTS
// http://localhost:3000 and docker-internal hostnames (zod#5577). This stack
// serves S3 from LocalStack in dev on a worktree-derived localhost port, so
// z.httpUrl() would trade an XSS hole for a broken dev environment.
//
// WHY http IS ALLOWED AT ALL. Production is https end to end, but dev resolves
// S3_PUBLIC_URL to http://localhost:<worktree port> and compose-internal traffic
// uses http://localstack:4566. Forbidding http here would make the schema
// environment-dependent, which a dependency-free contract package cannot be.
// Enforcing TLS is a deployment concern (AWS: "enforce HTTPS ... block HTTP at
// the edge"), not a parse-time one.
//
// WHY EXPIRY AND SIGNATURE ARE NOT VALIDATED HERE. AWS is explicit that
// X-Amz-Signature and X-Amz-Expires are evaluated by S3 at request time against
// the signing credentials. A schema cannot verify an HMAC without the signing
// key, would fight clock skew, and would reject URLs merely close to expiring.
// S3 is authoritative; re-checking it here is redundant validation. Short TTLs
// are a MINTING concern (PROOF_URL_TTL_SECONDS at the presigner).
import { z } from 'zod';

/** The only URL schemes an object-storage proof link may use.
 *
 *  Anchored at both ends and case-sensitive on purpose. Zod matches the parsed
 *  URL's protocol, which the URL constructor already lowercases, so JavaScript:
 *  normalises to javascript: and is rejected by the same rule -- asserted rather
 *  than assumed, because relying on unstated normalisation is how an allowlist
 *  quietly becomes bypassable. */
export const PROOF_URL_PROTOCOL = /^https?$/;

/** SSOT for a Phieu Can proof URL: a syntactically valid URL whose scheme is
 *  http or https. One definition consumed by StopProofSchema, so the API-authored
 *  outgoing shape and the ops-web client-parsed shape can never diverge on what
 *  is renderable. */
export const ProofUrlSchema = z.url({ protocol: PROOF_URL_PROTOCOL });
export type ProofUrl = z.infer<typeof ProofUrlSchema>;
