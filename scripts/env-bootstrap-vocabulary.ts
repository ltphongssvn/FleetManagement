// scripts/env-bootstrap-vocabulary.ts
// The env bootstrap's closed vocabularies, declared ONCE.
//
// WHY THIS FILE EXISTS. RefusalReason was a hand-written union in
// env-bootstrap-cli.ts and the same members were re-listed as an ALL_REASONS
// array in env-bootstrap-cli.test.ts -- one vocabulary, two declarations, with
// the test's copy driving three coverage assertions. Adding
// duplicate_plaintext_keys to the union would have left that array stale, and
// the tests would have gone on passing while silently covering one reason
// fewer. That is the same second-source-of-truth failure the roster's estate
// block produced, in a different file on the same afternoon.
//
// The canonical pattern: ONE frozen as-const array is the single definition,
// and both the literal-union type and the Zod schema derive from it.
//
// Zod gotcha the pattern exists to avoid: pass the array DIRECTLY. Handing
// z.enum a loosely-typed variable collapses inference to `string`, and the
// vocabulary silently stops constraining anything.
import { z } from 'zod';

/** Every way the bootstrap can refuse, in evaluation order.
 *
 *  Order is documentation, not behaviour -- decideBootstrap encodes the real
 *  precedence -- but keeping it aligned makes the two readable side by side. */
export const REFUSAL_REASONS = Object.freeze([
  'missing_binary',
  'missing_identity',
  'missing_encrypted',
  'missing_plaintext',
  'duplicate_plaintext_keys',
  'would_clobber_plaintext',
] as const);
export type RefusalReason = (typeof REFUSAL_REASONS)[number];
export const RefusalReasonSchema = z.enum(REFUSAL_REASONS);

/** The two directions the bootstrap runs in. */
export const BOOTSTRAP_MODES = Object.freeze(['encrypt', 'decrypt'] as const);
export type BootstrapMode = (typeof BOOTSTRAP_MODES)[number];
export const BootstrapModeSchema = z.enum(BOOTSTRAP_MODES);
