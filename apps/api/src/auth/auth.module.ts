// apps/api/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, importPKCS8 } from 'jose';
import bcrypt from 'bcryptjs';
import { JoseIdentityProvider } from './jose-identity-provider.js';
import { JwtGuard } from './jwt.guard.js';
import { OperatorContextFactory } from './operator-context.factory.js';
import { IDENTITY_PROVIDER } from './identity-provider.interface.js';
import { AuthLoginService } from './auth-login.service.js';
import { AuthLoginController } from './auth-login.controller.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import type { LoginClaims } from './auth-login-policy.js';

const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000000';

@Module({
  controllers: [AuthLoginController],
  providers: [
    { provide: IDENTITY_PROVIDER, useClass: JoseIdentityProvider },
    JwtGuard,
    OperatorContextFactory,
    {
      provide: AuthLoginService,
      inject: [DRIZZLE_DB, ConfigService],
      useFactory: async (db: FleetDb, config: ConfigService): Promise<AuthLoginService> => {
        const privatePem = config.get<string>('JWT_PRIVATE_KEY_PEM') ?? '';
        const issuer = config.get<string>('JWT_ISSUER') ?? 'fleet-pilot-api';
        const audience = config.get<string>('JWT_AUDIENCE') ?? 'fleet-driver';
        if (privatePem.length === 0) {
          // No signing key configured (e.g. test env); return a service that throws on use.
          const bcryptCompareNoop = (): Promise<boolean> => Promise.resolve(false);
          const signJwtNoop = (): Promise<string> => Promise.reject(new Error('JWT_PRIVATE_KEY_PEM not configured'));
          return new AuthLoginService(db, bcryptCompareNoop, signJwtNoop, DEFAULT_COMPANY_ID);
        }
        const privateKey = await importPKCS8(privatePem, 'ES256');
        const bcryptCompare = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);
        const signJwt = async (claims: LoginClaims): Promise<string> => {
          return new SignJWT({
            company_id: claims.companyId,
            business_unit_id: claims.businessUnitId,
            depot_id: claims.depotId,
            legal_entity_id: claims.legalEntityId,
            driver_id: claims.driverId,
          })
            .setProtectedHeader({ alg: 'ES256', kid: 'fleet-api-1' })
            .setIssuedAt()
            .setIssuer(issuer)
            .setAudience(audience)
            .setSubject(claims.sub)
            .setExpirationTime('24h')
            .sign(privateKey);
        };
        return new AuthLoginService(db, bcryptCompare, signJwt, DEFAULT_COMPANY_ID);
      },
    },
  ],
  exports: [IDENTITY_PROVIDER, JwtGuard, OperatorContextFactory],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AuthModule {}
