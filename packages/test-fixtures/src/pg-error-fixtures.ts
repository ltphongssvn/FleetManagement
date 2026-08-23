// packages/test-fixtures/src/pg-error-fixtures.ts
// Factories for synthesizing Postgres error shapes used by pg-errors and
// error-mapping tests. Centralizes the SQLSTATE 23505 magic string.
export function createPgUniqueViolation(
  overrides: { constraint?: string; message?: string } = {},
): Error {
  return Object.assign(
    new Error(overrides.message ?? 'duplicate key value violates unique constraint'),
    {
      code: '23505',
      ...(overrides.constraint !== undefined ? { constraint: overrides.constraint } : {}),
    },
  );
}

export function createWrappedError(message: string, cause: unknown): Error & { cause: unknown } {
  return new Error(message, { cause }) as Error & { cause: unknown };
}
