// apps/ops-web/src/features/auth/public-origin.ts
// Edge-safe SSOT for resolving the PUBLIC origin behind Railway. Kept in its
// OWN dependency-free module (imports only the NextRequest type) so the Next.js
// MIDDLEWARE (edge runtime) can use it WITHOUT pulling zod / the Keycloak refresh
// logic from session-refresh.ts into the edge bundle. Behind the edge proxy,
// req.url / req.nextUrl carry the container internal bind (0.0.0.0:3001), so
// new URL(path, req.url) would send the browser to https://0.0.0.0:3001/...
// (ERR_ADDRESS_INVALID). Order: x-forwarded-host/proto set by the proxy; else
// the origin of OIDC_REDIRECT_URI (the public callback URL); else req.url for
// local/dev. Consumed by the OIDC callback, the /api/auth/refresh route, AND
// the auth middleware -- one definition, so no layer can drift back to req.url.
import { type NextRequest } from 'next/server';

export function publicOrigin(req: NextRequest): string {
  const forwardedHost = req.headers.get('x-forwarded-host');
  if (forwardedHost !== null && forwardedHost.length > 0) {
    const proto = req.headers.get('x-forwarded-proto') ?? 'https';
    return proto + '://' + forwardedHost;
  }
  const redirectUri = process.env['OIDC_REDIRECT_URI'];
  if (redirectUri !== undefined && redirectUri.length > 0) {
    try {
      return new URL(redirectUri).origin;
    } catch {
      // fall through to req.url
    }
  }
  return new URL(req.url).origin;
}
