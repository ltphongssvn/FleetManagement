// apps/api/src/sync/parse-cursor.ts
// Pure cursor-string -> bigint coercion. Empty/'0' = bootstrap.
// Garbage strings coerce to 0n (never throws). Negative bigints clamp to 0n.
//
// Note: there is intentionally no `cursor === '' || cursor === '0'` fast-path.
// BigInt('0') is 0n and BigInt('') throws (caught below -> 0n), so an explicit
// sentinel guard is behaviorally redundant -- every branch of it would be an
// equivalent mutant. The single BigInt+clamp path below is the whole contract.
const ZERO = 0n;

/** Clamp a parsed bigint to the non-negative range. */
export function clampNonNegative(n: bigint): bigint {
  // Stryker disable next-line EqualityOperator: `n < ZERO` -> `n <= ZERO` is an
  // equivalent mutant. At n === 0n the false-branch returns n (0n) and the
  // true-branch returns ZERO (0n) -- identical output -- and for all other n
  // the two operators agree, so no input distinguishes them.
  return n < ZERO ? ZERO : n;
}

export function parseCursor(cursor: string): bigint {
  try {
    return clampNonNegative(BigInt(cursor));
  } catch {
    return ZERO;
  }
}
