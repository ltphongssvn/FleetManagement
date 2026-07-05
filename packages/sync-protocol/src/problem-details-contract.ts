// packages/sync-protocol/src/problem-details-contract.ts
// Shared RFC 9457 problem-details wire contract for ALL Fleet error responses.
// The api global exception filter EMITS this envelope (content type
// application/problem+json); driver-app/ops-web presenters CONSUME it and map
// the machine-readable code extension to friendly Vietnamese copy. Humans read
// title/detail; machines key ONLY off code (RFC 9457: consumers should not
// parse detail for information). looseObject preserves unknown extension
// members so the forgiving-FSM arc can add currentState/allowedActions with
// zero schema change; code is a LOOSE string at this wire boundary (an older
// app must not reject a newer envelope over an unknown code) while
// FleetErrorCodeSchema is the strict producer/mapper union -- the same
// two-tier pattern as ops-web login-error.ts.
import { z } from 'zod';

/** Strict producer-side union: every code the api may emit today. */
export const FLEET_ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INVALID_STATE_TRANSITION',
  'INTERNAL',
] as const;

export const FleetErrorCodeSchema = z.enum(FLEET_ERROR_CODES);
export type FleetErrorCode = z.infer<typeof FleetErrorCodeSchema>;

/** RFC 9457 media type for problem responses. */
export const PROBLEM_DETAILS_CONTENT_TYPE = 'application/problem+json';

// Base members per RFC 9457 section 3.1; only status is required at this
// boundary (a minimal envelope is still presentable). type stays a plain
// string: it is a URI *reference* (about:blank and relative refs are legal),
// so z.url() would over-reject.
export const ProblemDetailsSchema = z.looseObject({
  type: z.string().optional(),
  title: z.string().optional(),
  status: z.int().min(100).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string().optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

/** Safe boundary parse: a problem envelope or null, never a throw. */
export function parseProblemDetails(raw: unknown): ProblemDetails | null {
  const parsed = ProblemDetailsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
