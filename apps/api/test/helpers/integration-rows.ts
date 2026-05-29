// apps/api/test/helpers/integration-rows.ts
export function rowsOf<T>(result: { rows: readonly T[] } | readonly T[]): readonly T[] {
  if ('rows' in result) return result.rows;
  return result;
}
