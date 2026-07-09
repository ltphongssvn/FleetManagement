// apps/api/src/auth/jose-identity-provider.ts
// Dual-issuer JWT verifier. Two trust domains are accepted:
//   1. Self-issued tokens (driver phone+password flow) — JWT_ISSUER /
//      JWT_AUDIENCE, verified against the static ES256 public key.
//   2. OIDC tokens (ops-web login via the OIDC provider) — OIDC_ISSUER /
//      OIDC_AUDIENCE, verified against the provider's JWKS endpoint.
// The token's `iss` claim selects the verifier. This is the standard
// multi-issuer resource-server pattern: each relying party validates
// tokens independently against the issuer's keys (JWKS), checking iss,
// aud, exp, and signature. Self-issued PEM keys may be absent in
// OIDC-only deployments, so JWT_PUBLIC_KEY_PEM is optional.
//
// Roles: Keycloak emits realm roles under realm_access.roles. We surface
// them onto VerifiedIdentity.roles so the resource server can authorize
// (e.g. the fleet-owner role gates the owner dashboard) without importing
// Keycloak realm config. Absent on self-issued driver tokens, so optional.
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  jwtVerify, importSPKI, createRemoteJWKSet, decodeJwt,
  type CryptoKey, type JWTPayload, type JWTVerifyGetKey,
} from 'jose';
import type { Env } from '../config/env.config.js';
import type { IIdentityProvider, VerifiedIdentity } from './identity-provider.interface.js';
const ALLOWED_ALGORITHMS = ['ES256', 'RS256'] as const;
interface FleetClaims extends JWTPayload {
  readonly sub: string;
  readonly company_id?: string;
  readonly operator_id?: string;
  readonly acr?: string;
  readonly amr?: readonly string[];
  readonly realm_access?: { readonly roles?: readonly string[] };
}
@Injectable()
export class JoseIdentityProvider implements IIdentityProvider, OnModuleInit {
  private selfPublicKey: CryptoKey | null = null;
  private oidcJwks: JWTVerifyGetKey | null = null;
  private readonly selfIssuer: string;
  private readonly selfAudience: string;
  private readonly selfPublicPem: string | undefined;
  private readonly oidcIssuer: string;
  private readonly oidcAudience: string;
  private readonly oidcJwksUri: string;
  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.selfIssuer = config.getOrThrow('JWT_ISSUER', { infer: true });
    this.selfAudience = config.getOrThrow('JWT_AUDIENCE', { infer: true });
    this.selfPublicPem = config.get('JWT_PUBLIC_KEY_PEM', { infer: true });
    this.oidcIssuer = config.getOrThrow('OIDC_ISSUER', { infer: true });
    this.oidcAudience = config.getOrThrow('OIDC_AUDIENCE', { infer: true });
    this.oidcJwksUri = config.getOrThrow('OIDC_JWKS_URI', { infer: true });
  }
  async onModuleInit(): Promise<void> {
    if (this.selfPublicPem) {
      this.selfPublicKey = await importSPKI(this.selfPublicPem, 'ES256');
    }
    // createRemoteJWKSet lazily fetches + caches the provider's keys on
    // first verify; constructing it here is non-blocking.
    this.oidcJwks = createRemoteJWKSet(new URL(this.oidcJwksUri));
  }
  async verifyToken(token: string): Promise<VerifiedIdentity> {
    // Inspect the unverified issuer to route to the correct trust domain.
    // The signature is still fully verified below — decodeJwt only reads
    // the claim to pick the verifier; it does not establish trust.
    const issuer = decodeJwt(token).iss;
    let payload: FleetClaims;
    if (issuer === this.oidcIssuer) {
      if (!this.oidcJwks) throw new Error('OIDC JWKS not initialized');
      ({ payload } = await jwtVerify<FleetClaims>(token, this.oidcJwks, {
        issuer: this.oidcIssuer,
        audience: this.oidcAudience,
        algorithms: [...ALLOWED_ALGORITHMS],
      }));
    } else if (issuer === this.selfIssuer) {
      if (!this.selfPublicKey) {
        throw new Error('self-issued token received but JWT_PUBLIC_KEY_PEM not configured');
      }
      ({ payload } = await jwtVerify<FleetClaims>(token, this.selfPublicKey, {
        issuer: this.selfIssuer,
        audience: this.selfAudience,
        algorithms: [...ALLOWED_ALGORITHMS],
      }));
    } else {
      throw new Error('Token issuer ' + String(issuer) + ' is not trusted');
    }
    if (!payload.iat || !payload.exp) {
      throw new Error('Token missing iat/exp');
    }
    const operatorId = payload.operator_id ?? payload.sub;
    const companyId = payload.company_id;
    if (!companyId) throw new Error('Token missing company_id claim');
    const roles = payload.realm_access?.roles;
    // exactOptionalPropertyTypes: omit acr/amr/roles entirely when the token
    // lacks them (absent, not explicitly undefined) so they satisfy the
    // optional shape.
    return {
      subject: payload.sub,
      operatorId,
      companyId,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
      ...(payload.acr !== undefined ? { acr: payload.acr } : {}),
      ...(payload.amr !== undefined ? { amr: payload.amr } : {}),
      ...(roles !== undefined ? { roles } : {}),
    };
  }
}
