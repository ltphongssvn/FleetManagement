// apps/ops-web/src/lib/api-url.ts
// Factor III (Config) SSOT for the internal API base URL. FLEET_API_URL is
// deploy-varying config: it MUST be provided in production, where a silent
// fallback to a placeholder host would let requests succeed against the
// wrong backend. In non-production we default to the compose service host
// so local/dev/CI need no extra wiring. This replaces seven duplicated
// local getApiUrl() helpers that each hardcoded the http://api:3000 default
// unconditionally (dangerous in prod). Mirrors the driver-app HTTPS fail-
// fast getApiUrl precedent.
const COMPOSE_HOST = 'http://api:3000';

interface ApiUrlEnv {
  FLEET_API_URL?: string | undefined;
  NODE_ENV?: string | undefined;
}

export function getApiUrl(env: ApiUrlEnv = process.env): string {
  const configured = env.FLEET_API_URL;
  if (configured !== undefined && configured.length > 0) return configured;
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'FLEET_API_URL must be set in production (refusing to fall back to a compose-only host)',
    );
  }
  return COMPOSE_HOST;
}
