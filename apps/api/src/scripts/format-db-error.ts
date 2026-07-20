// apps/api/src/scripts/format-db-error.ts
// Root-cause fix (2026-07-19): admin/audit CLI scripts printed only
// err.message on failure. Since drizzle-orm 0.44.0 a failed query throws a
// DrizzleQueryError whose message is only the SQL text; the real database
// error -- node-postgres DatabaseError with .code / .detail / .severity, or a
// connection/auth error -- is on err.cause. Printing just the message made
// every prod failure indistinguishable (a live incident: an auth failure
// surfaced only as {DQ}Failed query: ...{DQ}). This walks the Error.cause chain
// (standard since ES2022) and surfaces the driver error with its pg code and
// detail. Pure formatter, no trust boundary, no duplicated contract shape ->
// plain TS by the two-axis rule (no Zod).
//
// Reference: drizzle-team/drizzle-orm discussion #916 and issue #4660 --
// extract the original pg error from the wrapped cause; map .code/.detail.

interface PgErrorLike {
  message?: unknown;
  code?: unknown;
  detail?: unknown;
  cause?: unknown;
}

function asRecord(value: unknown): PgErrorLike | null {
  return typeof value === 'object' && value !== null ? (value as PgErrorLike) : null;
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  const rec = asRecord(value);
  if (rec && typeof rec.message === 'string') return rec.message;
  return String(value);
}

// Collect each distinct link of the cause chain, outermost first, so the SQL
// wrapper AND the underlying driver error are both shown -- deduplicated so an
// identical repeated message is not printed twice.
export function formatDbError(err: unknown): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let current: unknown = err;
  let guard = 0;

  while (current !== undefined && current !== null && guard < 10) {
    guard += 1;
    const rec = asRecord(current);
    const msg = messageOf(current);

    const codeRaw = rec ? rec.code : undefined;
    const code = typeof codeRaw === 'string' || typeof codeRaw === 'number' ? String(codeRaw) : '';
    const detailRaw = rec ? rec.detail : undefined;
    const detail = typeof detailRaw === 'string' ? detailRaw : '';

    let line = code ? '[' + code + '] ' + msg : msg;
    if (detail && !line.includes(detail)) line += ' -- ' + detail;

    if (!seen.has(line)) {
      seen.add(line);
      parts.push(line);
    }

    current = rec ? rec.cause : undefined;
  }

  return parts.length > 0 ? parts.join(': ') : String(err);
}
