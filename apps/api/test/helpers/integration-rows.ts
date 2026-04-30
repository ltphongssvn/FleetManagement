// apps/api/test/helpers/integration-rows.ts
// Drizzle's db.execute() returns { rows: T[] } via node-postgres but bare T[]
// via other drivers. This helper centralizes the cast in one place so test
// assertions stay readable.
export function rowsOf<T>(result: unknown): readonly T[] {
  if (typeof result === 'object' && result !== null && 'rows' in result) {
    return (result as { rows: readonly T[] }).rows;
  }
  return result as readonly T[];
}
