// apps/ops-web/src/features/auth/oidc-pkce.ts
// Pure builder for the browser Authorization Code + PKCE login request. No I/O,
// no cookies: config + an injected random source in, { authorizeUrl, state,
// nonce, codeVerifier } out. The caller (login server action) persists the
// transient secrets in httpOnly cookies and performs the redirect. SHA-256 via
// Web Crypto (available in the Next.js server runtime); base64url, no padding,
// per RFC 7636.
import 'server-only';
import {
  AuthorizationRequestConfigSchema,
  type AuthorizationRequest,
  type AuthorizationRequestConfigInput,
} from './oidc-authorization.schema';

// Injected so the builder is deterministic under test. Each call returns a
// high-entropy URL-safe string (>= 256 bits recommended for the verifier).
export interface PkceRandomSource {
  randomBase64Url: (byteLength?: number) => string;
}

export async function deriveCodeChallenge(codeVerifier: string): Promise<string> {
  // Node-native base64url (RFC 4648 §5): - for +, _ for /, no padding. The
  // idiomatic 2026 encoding for a PKCE S256 challenge - no fragile btoa+regex.
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(new Uint8Array(digest)).toString('base64url');
}

export async function buildAuthorizationRequest(
  rawConfig: AuthorizationRequestConfigInput,
  random: PkceRandomSource,
): Promise<AuthorizationRequest> {
  const config = AuthorizationRequestConfigSchema.parse(rawConfig);
  const codeVerifier = random.randomBase64Url(32);
  const state = random.randomBase64Url(16);
  const nonce = random.randomBase64Url(16);
  const codeChallenge = await deriveCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(' '),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });
  if (config.acrValues !== undefined) {
    params.set('acr_values', config.acrValues);
  }

  return {
    authorizeUrl: config.authorizationEndpoint + '?' + params.toString(),
    state,
    nonce,
    codeVerifier,
  };
}
