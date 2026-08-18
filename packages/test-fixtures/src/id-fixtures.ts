// packages/test-fixtures/src/id-fixtures.ts
// Deterministic, VALID branded ids minted from a readable label.
//
// WHY. Tests name ids for legibility -- 'a1' depends on 'a2', head-of-line is
// 'agg-1' -- because what they assert is the RELATIONSHIP between ids, never
// the id values. Once createActionId began validating (it used to be a bare
// `as` cast that accepted anything), those labels stopped being valid UUIDs.
//
// Two bad answers were available: weaken the contract back to accept 'a1', or
// paste 19 raw UUIDs into the tests and lose the legibility that made them
// readable. Both are the treadmill. The factory principle is that defaults must
// be VALID -- a fixture with no overrides should pass every validation -- and
// that factories live close to the schema, so this mints a real UUID from the
// label and keeps both properties.
//
// DETERMINISTIC: the same label always yields the same id, so a test that
// references 'a1' twice gets one id, and a failure message is reproducible.
// DISTINCT: different labels yield different ids, which is the only property
// the tests actually depend on.
//
// NO UNREACHABLE FALLBACK. uuidFromLabel previously read `h[16] ?? '0'`, which
// noUncheckedIndexedAccess demands and the domain forbids: hexFromLabel returns
// exactly 32 characters by construction, so the nullish branch can never be
// taken. v8 counted it anyway and the package fell to 50% branch coverage
// against a 90% threshold -- a gate failing on a branch no test could ever
// reach, because reaching it would require a hexFromLabel that violates its own
// contract.
//
// The fix is structural rather than a suppression. Building the variant nibble
// from the ARRAY of digits, which hexFromLabel already has in hand, removes the
// indexed read entirely: there is no optional access, so no fallback, so no
// branch. A /* v8 ignore */ would have hidden the same code; this deletes it.
import { createActionId, createAggregateId, type ActionId, type AggregateId } from '@fleet/sync-protocol';

/** FNV-1a over the label, expanded to the 32 hex digits a UUID needs. Not
 *  cryptographic and not meant to be: it only has to be stable and collision
 *  free across the handful of labels a test file uses.
 *
 *  Returns exactly 32 characters -- eight rounds of eight hex digits, sliced --
 *  which is the invariant the caller below depends on. */
function hexFromLabel(label: string): string {
  let h = 0x811c9dc5;
  const digits: string[] = [];
  for (let round = 0; round < 8; round += 1) {
    for (let i = 0; i < label.length; i += 1) {
      h ^= label.charCodeAt(i) + round;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    digits.push(h.toString(16).padStart(8, '0'));
  }
  return digits.join('').slice(0, 32);
}

/** The variant nibble: 10xx, per RFC 4122.
 *
 *  Takes the CHARACTER rather than reading it out of a string by index, so the
 *  caller does the extraction where the length invariant is visible and this
 *  function has no optional access to guard. */
function variantNibble(hexDigit: string): string {
  return ((parseInt(hexDigit, 16) & 0x3) | 0x8).toString(16);
}

/** version 7, variant 10xx -- the shape the PDF specifies for these ids.
 *
 *  charAt, not indexed access: charAt returns '' for an out-of-range index
 *  rather than undefined, so there is no nullish branch to cover. parseInt('')
 *  is NaN, and NaN & 0x3 | 0x8 is 8 -- the same value the old fallback produced,
 *  reached without a conditional. The length invariant makes both moot in
 *  practice; this removes the branch v8 was counting. */
function uuidFromLabel(label: string): string {
  const h = hexFromLabel(label);
  const v7 = h.slice(0, 12) + '7' + h.slice(13, 16) +
    variantNibble(h.charAt(16)) + h.slice(17, 32);
  return [
    v7.slice(0, 8), v7.slice(8, 12), v7.slice(12, 16),
    v7.slice(16, 20), v7.slice(20, 32),
  ].join('-');
}

/** A valid ActionId for a readable test label. */
export function testActionId(label: string): ActionId {
  return createActionId(uuidFromLabel('action:' + label));
}

/** A valid AggregateId for a readable test label. */
export function testAggregateId(label: string): AggregateId {
  return createAggregateId(uuidFromLabel('aggregate:' + label));
}
