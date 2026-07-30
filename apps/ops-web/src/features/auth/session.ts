// apps/ops-web/src/features/auth/session.ts
// Single owner of the fleet_session cookie shape.
//
// WHY THIS EXISTS: decodeUsername lived inline in app/admin, so a second
// consumer -- the /admin segment layout -- would have had to copy it. Two
// copies of a claims parser is an Axis-2 violation: the shape would drift the
// moment either side changed. One module, one owner, imported by both.
//
// It also moves the parser INTO the coverage gate. vitest excludes src/app/**
// (routing wireframes), so while this lived in page.tsx its four failure
// branches were untested by construction -- an unusual place for a security
// adjacent parser to hide. Under src/features it is covered perFile at
// 90/90/90/90 like every other module.
//
// AXIS-1: the JWT payload is untrusted input. It arrives from a cookie the
// browser can set, and this app does not verify the signature here -- the API
// does that on every request. develop asserted the shape with
// JSON.parse(...) as {...}, which type-checks but validates nothing: a payload
// that is valid JSON yet not an object (a bare string, an array, a number)
// would reach property access unchallenged. safeParse against a schema makes
// the check real, and a failed parse degrades to undefined -- the username is
// display-only chrome, so an unreadable token must never break the page.
import 'server-only';
import { cookies } from 'next/headers';
import { z } from 'zod';

export const SESSION_COOKIE = 'fleet_session';

// Only the claims this module consumes. Keycloak sends many more; passthrough
// is deliberate -- extra claims are not an error, they are simply not ours.
const SessionClaimsSchema = z.object({
  preferred_username: z.string().optional(),
  sub: z.string().optional(),
});

// Pure. Decodes the JWT payload segment and returns a display name, or
// undefined for any token that is absent, malformed, or not shaped as claims.
export function decodeUsername(token: string | undefined): string | undefined {
  if (token === undefined || token === '') return undefined;
  const payload = token.split('.')[1];
  if (payload === undefined) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  const parsed = SessionClaimsSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  return parsed.data.preferred_username ?? parsed.data.sub;
}

// Request-time read of the signed-in username, for shell chrome.
//
// Deliberately NOT wrapped in React cache(): cache() dedupes work within a
// single render, and the two callers (the dispatch board page and the /admin
// segment layout) never co-render. The work is a base64 decode, not a fetch,
// so memoising it would add indirection for no measurable saving.
export async function getSessionUsername(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return decodeUsername(cookieStore.get(SESSION_COOKIE)?.value);
}
