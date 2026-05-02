// apps/api/src/sync/parse-cursor.ts
// Pure cursor-string -> bigint coercion. Empty/'0' = bootstrap.
// Garbage strings coerce to 0n (never throws). Negative bigints clamp to 0n.
export function parseCursor(cursor: string): bigint {
  if (cursor === '' || cursor === '0') return 0n;
  try {
    const n = BigInt(cursor);
    return n < 0n ? 0n : n;
  } catch {
    return 0n;
  }
}
