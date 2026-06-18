// apps/ops-web/src/features/auth/oidc-authorization.schema.ts
// Schema-first contract for the browser Authorization Code + PKCE login flow
// (replacing the ROPC password grant). ops-web redirects the user to Keycloak's
// authorization endpoint with a PKCE S256 challenge + state + nonce; those
// transient secrets are persisted in httpOnly cookies and validated at callback.
// acrValues is optional so privileged roles (dispatcher) can be forced through
// MFA at login, matching the API's RFC 9470 step-up enforcement.
import { z } from 'zod';

export const AuthorizationRequestConfigSchema = z.object({
  authorizationEndpoint: z.string().url(),
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
  scopes: z.array(z.string().min(1)).min(1).default(['openid', 'profile', 'fleet']),
  acrValues: z.string().min(1).optional(),
});
export type AuthorizationRequestConfig = z.infer<typeof AuthorizationRequestConfigSchema>;
export type AuthorizationRequestConfigInput = z.input<typeof AuthorizationRequestConfigSchema>;

// Transient PKCE / anti-forgery values the caller must persist (httpOnly cookies)
// to validate the callback, returned alongside the redirect URL.
export interface AuthorizationRequest {
  readonly authorizeUrl: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}
