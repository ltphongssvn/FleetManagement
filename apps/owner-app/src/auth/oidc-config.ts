// apps/owner-app/src/auth/oidc-config.ts
// Pure OIDC PKCE config builder for the owner app's Keycloak login.
// RFC 8252 mandates native apps use Authorization Code + PKCE in the system
// browser; OAuth 2.1 removes ROPC and requires PKCE for all auth-code clients.
// expo-auth-session consumes this shape (discoveryUrl for auto-discovery,
// clientId, redirectUri, scopes, usePKCE) - see use-auth.tsx. Env is the trust
// boundary (EXPO_PUBLIC_* values are injected at build), so it is Zod-validated
// here; everything downstream derives from that single parsed shape.
import { z } from 'zod';

export const OWNER_OIDC_SCOPES = Object.freeze(['openid', 'profile'] as const);

export const OwnerOidcEnvSchema = z.object({
  EXPO_PUBLIC_OIDC_ISSUER: z.url(),
  EXPO_PUBLIC_OIDC_CLIENT_ID: z.string().min(1),
  EXPO_PUBLIC_OWNER_APP_SCHEME: z.string().min(1),
});
export type OwnerOidcEnv = z.infer<typeof OwnerOidcEnvSchema>;

export interface OwnerOidcConfig {
  readonly discoveryUrl: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly usePKCE: true;
}

// Parses env (throws on invalid) and derives the full authorization-request
// config. Trailing slashes on the issuer are normalised so the discovery URL
// is well-formed regardless of how the issuer was configured.
export function buildOwnerOidcConfig(rawEnv: unknown): OwnerOidcConfig {
  const env = OwnerOidcEnvSchema.parse(rawEnv);
  const issuer = env.EXPO_PUBLIC_OIDC_ISSUER.replace(/\/+$/, '');
  return {
    discoveryUrl: issuer + '/.well-known/openid-configuration',
    clientId: env.EXPO_PUBLIC_OIDC_CLIENT_ID,
    redirectUri: env.EXPO_PUBLIC_OWNER_APP_SCHEME + '://redirect',
    scopes: [...OWNER_OIDC_SCOPES],
    usePKCE: true,
  };
}
