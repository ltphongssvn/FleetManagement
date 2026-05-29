// apps/driver-app/src/auth/auth-flow.ts
// OIDC authorization-code exchange. Native screen captures `code` from the
// redirect URI, hands it here, gets back tokens to put in SecureStore.
// PDF: "Corporate OIDC first; Keycloak fallback; SecureStore (native)".
import { z } from 'zod';

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
});

export interface ExchangeAuthCodeInput {
  readonly tokenEndpoint: string;
  readonly code: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeVerifier?: string;
  readonly fetchFn?: typeof globalThis.fetch;
}

export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: number;
}

export async function exchangeAuthCode(input: ExchangeAuthCodeInput): Promise<AuthTokens> {
  const fetchFn = input.fetchFn ?? globalThis.fetch;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
  });
  const res = await fetchFn(input.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`OIDC token exchange HTTP ${String(res.status)} ${res.statusText}`);
  }
  const json = (await res.json()) as unknown;
  const parsed = TokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`OIDC token response invalid: ${parsed.error.message}`);
  }
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token ?? null,
    expiresAt: Math.floor(Date.now() / 1000) + parsed.data.expires_in,
  };
}

export function isTokenExpired(tokens: AuthTokens, nowSec: number): boolean {
  return tokens.expiresAt <= nowSec;
}
