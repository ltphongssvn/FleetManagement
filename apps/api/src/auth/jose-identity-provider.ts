// apps/api/src/auth/jose-identity-provider.ts
// jose-based JWT verifier. Uses local public key for self-issued tokens (phone+password flow).
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify, importSPKI, type CryptoKey, type JWTPayload } from 'jose';
import type { Env } from '../config/env.config.js';
import type { IIdentityProvider, VerifiedIdentity } from './identity-provider.interface.js';

const ALLOWED_ALGORITHMS = ['ES256'] as const;

interface FleetClaims extends JWTPayload {
  readonly sub: string;
  readonly company_id?: string;
  readonly operator_id?: string;
}

@Injectable()
export class JoseIdentityProvider implements IIdentityProvider, OnModuleInit {
  private publicKey!: CryptoKey;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly publicPem: string;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.issuer = config.getOrThrow('JWT_ISSUER', { infer: true });
    this.audience = config.getOrThrow('JWT_AUDIENCE', { infer: true });
    this.publicPem = config.getOrThrow('JWT_PUBLIC_KEY_PEM', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    this.publicKey = await importSPKI(this.publicPem, 'ES256');
  }

  async verifyToken(token: string): Promise<VerifiedIdentity> {
    const { payload } = await jwtVerify<FleetClaims>(token, this.publicKey, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: [...ALLOWED_ALGORITHMS],
    });
    if (!payload.iat || !payload.exp) {
      throw new Error('Token missing iat/exp');
    }
    const operatorId = payload.operator_id ?? payload.sub;
    const companyId = payload.company_id;
    if (!companyId) throw new Error('Token missing company_id claim');
    return {
      subject: payload.sub,
      operatorId,
      companyId,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  }
}
