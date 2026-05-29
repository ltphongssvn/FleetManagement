// packages/observability/src/dsn.ts
// Runtime DSN validation. Sentry DSN format:
//   https://<publicKey>@<host>/<projectId>
// Returning a parsed result (instead of throwing) lets bootstrap code decide
// whether a malformed DSN should fail-fast or skip Sentry init silently.
import { z } from 'zod';

const DSN_REGEX = /^https:\/\/[a-f0-9]+@[a-zA-Z0-9.-]+\/\d+$/;

export const dsnSchema = z
  .string()
  .min(1, 'DSN must not be empty')
  .regex(DSN_REGEX, 'DSN must match https://<publicKey>@<host>/<projectId>');

export type ValidatedDsn = z.infer<typeof dsnSchema>;

export interface DsnParseResult {
  valid: boolean;
  dsn?: ValidatedDsn;
  error?: string;
}

/**
 * Validate a DSN string. Returns a result object rather than throwing so
 * callers can choose between fail-fast and skip-init behavior.
 */
export function parseDsn(input: string | undefined): DsnParseResult {
  if (input === undefined || input === '') {
    return { valid: false, error: 'DSN is undefined or empty' };
  }
  const result = dsnSchema.safeParse(input);
  if (!result.success) {
    // zod safeParse always populates issues[0] on failure; non-null assertion is safe
    /* c8 ignore next */
    return { valid: false, error: result.error.issues[0]?.message ?? 'Invalid DSN' };
  }
  return { valid: true, dsn: result.data };
}
