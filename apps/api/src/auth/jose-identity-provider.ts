// apps/api/src/auth/jose-identity-provider.ts
// jose-based JWT verifier. Edge-compatible, native Web Crypto, no Passport.
// Algorithm allow-list enforces ES256/EdDSA per 2026 best practice — HS256 rejected.
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';
import type { Env } from '../config/env.config.js';
import type { IIdentityProvider, VerifiedIdentity } from './identity-provider.interface.js';

const ALLOWED_ALGORITHMS = ['ES256', 'EdDSA'] as const;

interface FleetClaims extends JWTPayload {
  readonly sub: string;
  readonly operator_id: string;
  readonly company_id: string;
}

@Injectable()
export class JoseIdentityProvider implements IIdentityProvider {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.issuer = config.getOrThrow('OIDC_ISSUER', { infer: true });
    this.audience = config.getOrThrow('OIDC_AUDIENCE', { infer: true });
    const jwksUrl = new URL(config.getOrThrow('OIDC_JWKS_URI', { infer: true }));
    this.jwks = createRemoteJWKSet(jwksUrl);
  }

  async verifyToken(token: string): Promise<VerifiedIdentity> {
    const { payload } = await jwtVerify<FleetClaims>(token, this.jwks, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: [...ALLOWED_ALGORITHMS],
    });
    if (!payload.iat || !payload.exp) {
      throw new Error('Token missing iat/exp');
    }
    return {
      subject: payload.sub,
      operatorId: payload.operator_id,
      companyId: payload.company_id,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  }
}
