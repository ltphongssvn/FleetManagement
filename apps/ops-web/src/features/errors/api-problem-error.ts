// apps/ops-web/src/features/errors/api-problem-error.ts
// SSOT error type for BFF /api responses consumed by browser clients.
// Carries the HTTP status plus the machine code Zod-parsed from the RFC 9457
// problem+json body (trust boundary -- parseProblemDetails, never a cast).
// The message is caller-provided DISPLAY text. The ensureOk seam composes
// a status-leading message ('401 UNAUTHORIZED ...')
// because the presenter seam (vnExceptionMessage) maps a LEADING status
// through the status-class rules -- the old '/path HTTP 401' trailing shape
// made the friendly copy structurally unreachable (prod 2026-07-11,
// Loi: load failed on Quan ly tai xe & xe after idle). ensureOk() is the one
// throw site every client method rides.
import { parseProblemDetails } from '@fleet/sync-protocol';

export class ApiProblemError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = 'ApiProblemError';
    this.status = status;
    this.code = code;
  }
}

// Throw-on-!ok seam: parses the problem body (safe: non-JSON bodies yield
// null -> code undefined) and throws the presenter-compatible error. Returns
// the response untouched when ok so callers keep their existing json() flow.
export async function ensureOk(res: Response, context: string): Promise<Response> {
  if (res.ok) return res;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const problem = parseProblemDetails(body);
  const lead = String(res.status) + (problem?.code !== undefined ? ' ' + problem.code : '');
  throw new ApiProblemError(res.status, problem?.code, lead + ' ' + context);
}
