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
import { createActionId, createAggregateId, type ActionId, type AggregateId } from '@fleet/sync-protocol';

/** FNV-1a over the label, expanded to the 32 hex digits a UUID needs. Not
 *  cryptographic and not meant to be: it only has to be stable and collision
 *  free across the handful of labels a test file uses. */
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

/** version 7, variant 10xx -- the shape the PDF specifies for these ids. */
function uuidFromLabel(label: string): string {
  const h = hexFromLabel(label);
  const v7 = h.slice(0, 12) + '7' + h.slice(13, 16) +
    ((parseInt(h[16] ?? '0', 16) & 0x3 | 0x8).toString(16)) + h.slice(17, 32);
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
