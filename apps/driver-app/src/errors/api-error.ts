// apps/driver-app/src/errors/api-error.ts
// Typed HTTP error for every driver-app client. Root cause being fixed:
// DeliveryLifecycleClient.post() threw
// new Error(POST <url> HTTP <status> <statusText>) WITHOUT reading the
// response body, so the RFC 9457 envelope the api emits was discarded and the
// raw URL + status line leaked straight into the on-screen banner. ApiError:
// - extends Error, so every existing err instanceof Error guard and the
//   useMutation<_, Error, _> generic keep working unchanged;
// - carries the parsed ProblemDetails envelope (null when the body is not an
//   envelope -- legacy shapes, plain text, empty bodies degrade safely);
// - exposes code (loose string, forward-compatible per the two-tier contract
//   rule) as the machine seam the Vietnamese presenter keys off;
// - message = envelope detail when present, else a URL-free HTTP <status>
//   fallback. A URL can NEVER appear in message, so even an unmapped render
//   site cannot reproduce the screenshot defect.
import { parseProblemDetails, type ProblemDetails } from '@fleet/sync-protocol';

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails | null;

  private constructor(message: string, status: number, problem: ProblemDetails | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }

  /** Machine-readable code extension for presenter mapping, if the envelope carried one. */
  get code(): string | undefined {
    return this.problem?.code;
  }

  /** Build from an HTTP status + already-parsed response body (unknown shape). */
  static fromBody(status: number, body: unknown): ApiError {
    const problem = parseProblemDetails(body);
    const message =
      problem?.detail !== undefined && problem.detail.length > 0
        ? problem.detail
        : 'HTTP ' + String(status);
    return new ApiError(message, status, problem);
  }
}
