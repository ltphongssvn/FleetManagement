// packages/test-fixtures/src/provenance-fixtures.ts
// Build-provenance test fixtures that are VALID BY CONSTRUCTION.
//
// ROOT CAUSE THIS ELIMINATES. health.version.controller.test.ts hand-wrote
// commit shas as readable literals -- "commit-sha-fixture-1234567",
// "railwaysha9876543", "1111111explicit". None is a 40-hex sha, so the suite
// asserted shortSha values like "commit-" that git can never produce, and
// proved behaviour against an impossible shape. It went unnoticed for as long
// as nothing validated the field.
//
// Editing those literals would fix the instance, not the class: the next
// hand-written sha reintroduces it. A factory cannot emit an invalid value, so
// the defect becomes unreachable rather than merely absent.
//
// Deterministic, never random: a fixture that differs per run turns a failure
// into a puzzle. Callers pass a seed when they need two distinct shas.

const HEX = '0123456789abcdef';
const SHA_LENGTH = 40;

// String.slice is TOTAL: it returns string, never string | undefined, so no
// fallback branch exists to be written or tested.
//
// Indexing (HEX[i]) would be string | undefined under noUncheckedIndexedAccess,
// and the usual answers are both wrong here. A non-null assertion hides the one
// failure that matters -- an undefined slipping in would render "undefined"
// INSIDE a sha, producing exactly the invalid fixture this module exists to
// prevent. A `?? '0'` fallback is unreachable by construction (the modulo
// cannot leave 0..15), so it is dead code that a branch-coverage gate rightly
// fails on: it cost this file 75% branch coverage against a 90% threshold.
function hexAt(index: number): string {
  const i = index % HEX.length;
  return HEX.slice(i, i + 1);
}

/** A deterministic, schema-valid 40-hex commit sha.
 *
 *  Distinct seeds yield distinct shas, so a test can express "the explicit
 *  stamp beats the platform one" without inventing literals. The same seed
 *  always yields the same sha, so a failure reproduces exactly. */
export function testSha(seed = 1): string {
  let state = seed * 2654435761;
  let out = '';
  for (let i = 0; i < SHA_LENGTH; i += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    out += hexAt(state >>> 8);
  }
  return out;
}

/** The short form the provenance contract derives, so a test never restates
 *  the slice length and can never assert a shortSha that disagrees with its
 *  own sha. */
export function testShortSha(seed = 1): string {
  return testSha(seed).slice(0, 7);
}

/** Values that LOOK like provenance but are not, for the boundary cases that
 *  must fail loudly. Each is a real mistake seen in the wild: a release tag
 *  stamped instead of a sha, a truncated short sha, uppercase hex from a
 *  copy-paste, and the blank Docker leaves when an ARG is never passed. */
export const INVALID_SHA_FIXTURES = Object.freeze({
  releaseTag: 'v2.65.0',
  truncated: testSha(1).slice(0, 12),
  uppercase: testSha(1).toUpperCase(),
  blank: '',
} as const);
