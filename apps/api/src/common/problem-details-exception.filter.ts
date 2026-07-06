// apps/api/src/common/problem-details-exception.filter.ts
// API-wide catch-all filter emitting the RFC 9457 problem-details envelope
// from @fleet/sync-protocol (Content-Type: application/problem+json).
// Registration contract (main.ts): this filter is registered FIRST and
// ZodExceptionFilter LAST -- Nest evaluates filters in reverse registration
// order, so ZodError keeps its existing 400 validation shape and everything
// else lands here. Humans read title/detail; machines key ONLY off the code
// extension (RFC 9457: consumers should not parse detail). code is defaulted
// from the status and overridable by an explicit code member on an
// HttpException response object -- the seam the forgiving-FSM arc uses to
// ship INVALID_STATE_TRANSITION on 409. Unknown exceptions become a generic
// 500 with a FIXED detail: no message, stack, or infrastructure detail can
// ever leak to a client; they are captureException-ed to Sentry instead.
// HttpExceptions are domain flow control and are never reported.
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PROBLEM_DETAILS_CONTENT_TYPE, type FleetErrorCode } from '@fleet/sync-protocol';
import type { Response, Request } from 'express';

const STATUS_TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  500: 'Internal Server Error',
};

const STATUS_CODES: Readonly<Record<number, FleetErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
};

function titleFor(status: number): string {
  return STATUS_TITLES[status] ?? (status >= 500 ? 'Internal Server Error' : 'Error');
}

function defaultCodeFor(status: number): FleetErrorCode | undefined {
  if (status >= 500) return 'INTERNAL';
  return STATUS_CODES[status];
}

/** RFC 9457 reserved envelope members: an explicit extensions object can
 * never overwrite these (shield against producer bugs reinstating the
 * leak/overwrite class this filter exists to kill). */
const RESERVED_MEMBERS: ReadonlySet<string> = new Set([
  'type', 'title', 'status', 'detail', 'instance', 'code',
]);

/** detail + optional explicit code + optional shielded extensions from an
 * HttpException response payload. Extensions are OPT-IN (a named object
 * member, never a blind spread of the response) -- the seam the 409
 * INVALID_STATE_TRANSITION / MANIFESTS_INCOMPLETE rejections use. */
function extractHttp(ex: HttpException): { detail: string; code?: string; extensions?: Record<string, unknown> } {
  const raw: unknown = ex.getResponse();
  if (typeof raw === 'string') return { detail: raw };
  if (typeof raw === 'object' && raw !== null) {
    const r = raw as Record<string, unknown>;
    const msg = r['message'];
    const detail = Array.isArray(msg)
      ? msg.map(String).join('; ')
      : typeof msg === 'string'
        ? msg
        : ex.message;
    const code = typeof r['code'] === 'string' ? r['code'] : undefined;
    const rawExt = r['extensions'];
    let extensions: Record<string, unknown> | undefined;
    if (typeof rawExt === 'object' && rawExt !== null && !Array.isArray(rawExt)) {
      const filtered = Object.fromEntries(
        Object.entries(rawExt as Record<string, unknown>).filter(([k]) => !RESERVED_MEMBERS.has(k)),
      );
      if (Object.keys(filtered).length > 0) extensions = filtered;
    }
    return {
      detail,
      ...(code === undefined ? {} : { code }),
      ...(extensions === undefined ? {} : { extensions }),
    };
  }
  return { detail: ex.message };
}

@Catch()
export class ProblemDetailsExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const instance = request.url;

    let status = 500;
    let detail = 'An unexpected error occurred.';
    let code: string | undefined = 'INTERNAL';
    let extensions: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const extracted = extractHttp(exception);
      detail = extracted.detail;
      code = extracted.code ?? defaultCodeFor(status);
      extensions = extracted.extensions;
    } else {
      // Unknown = a real defect: page via Sentry, leak nothing to the client.
      Sentry.captureException(exception);
    }

    const body: Record<string, unknown> = {
      // Shielded extensions FIRST: reserved members below always win.
      ...(extensions ?? {}),
      title: titleFor(status),
      status,
      detail,
      instance,
    };
    if (code !== undefined) body['code'] = code;

    response.setHeader('Content-Type', PROBLEM_DETAILS_CONTENT_TYPE);
    response.status(status).json(body);
  }
}
