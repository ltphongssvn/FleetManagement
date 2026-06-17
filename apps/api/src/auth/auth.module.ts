// apps/api/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { RedisChallengeStore, type ChallengeStorePort } from './redis-challenge-store.js';
import { SignJWT, importPKCS8 } from 'jose';
import bcrypt from 'bcryptjs';
import {
  generateRegistrationOptions as swaGenReg,
  verifyRegistrationResponse as swaVerifyReg,
  generateAuthenticationOptions as swaGenAuth,
  verifyAuthenticationResponse as swaVerifyAuth,
} from '@simplewebauthn/server';
import { eq } from 'drizzle-orm';
import { JoseIdentityProvider } from './jose-identity-provider.js';
import { JwtGuard } from './jwt.guard.js';
import { OperatorContextFactory } from './operator-context.factory.js';
import { IDENTITY_PROVIDER } from './identity-provider.interface.js';
import { AuthLoginService } from './auth-login.service.js';
import { AuthLoginController } from './auth-login.controller.js';
import { PasskeyController, SIGN_JWT_TOKEN } from './passkey.controller.js';
import { PasskeyCredentialRepository } from './passkey-credential.repository.js';
import {
  PasskeyRegistrationService,
  type DriverLookupFn,
  type GenerateRegistrationOptionsFn,
  type VerifyRegistrationResponseFn
} from './passkey-registration.service.js';
import {
  PasskeyAuthenticationService,
  type CredentialLookupFn,
  type GenerateAuthenticationOptionsFn,
  type VerifyAuthenticationResponseFn
} from './passkey-authentication.service.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import type { LoginClaims } from './auth-login-policy.js';
import { driver } from '../database/schema/reference.js';
import { passkeyCredential } from '../database/schema/passkey-credential.js';

const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000000';

// Redis-backed challenge store token. Replaces the former in-process Map (which
// broke across replicas and lost challenges on restart). The provider builds a
// lazy ioredis client from REDIS_URL — no connection at module-boot, so DI wiring
// resolves without a live Redis; the connection opens on first put/take.
export const CHALLENGE_STORE = Symbol('CHALLENGE_STORE');

const CHALLENGE_TTL_SECONDS = 60;

@Module({
  controllers: [AuthLoginController, PasskeyController],
  providers: [
    { provide: IDENTITY_PROVIDER, useClass: JoseIdentityProvider },
    JwtGuard,
    OperatorContextFactory,
    {
      provide: SIGN_JWT_TOKEN,
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<(claims: LoginClaims) => Promise<string>> => {
        const privatePem = config.get<string>('JWT_PRIVATE_KEY_PEM') ?? '';
        const issuer = config.get<string>('JWT_ISSUER') ?? 'fleet-pilot-api';
        const audience = config.get<string>('JWT_AUDIENCE') ?? 'fleet-driver';
        if (privatePem.length === 0) {
          return (): Promise<string> => Promise.reject(new Error('JWT_PRIVATE_KEY_PEM not configured'));
        }
        const privateKey = await importPKCS8(privatePem, 'ES256');
        return async (claims: LoginClaims): Promise<string> => {
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
      },
    },
    {
      provide: AuthLoginService,
      inject: [DRIZZLE_DB, SIGN_JWT_TOKEN],
      useFactory: (db: FleetDb, signJwt: (c: LoginClaims) => Promise<string>): AuthLoginService => {
        const bcryptCompare = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);
        return new AuthLoginService(db, bcryptCompare, signJwt, DEFAULT_COMPANY_ID);
      },
    },
    {
      provide: PasskeyCredentialRepository,
      inject: [DRIZZLE_DB],
      useFactory: (db: FleetDb): PasskeyCredentialRepository => new PasskeyCredentialRepository(db),
    },
    {
      provide: CHALLENGE_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ChallengeStorePort => {
        const url = config.getOrThrow<string>('REDIS_URL');
        const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
        return new RedisChallengeStore(redis, CHALLENGE_TTL_SECONDS);
      },
    },
    {
      provide: PasskeyRegistrationService,
      inject: [DRIZZLE_DB, PasskeyCredentialRepository, CHALLENGE_STORE, ConfigService],
      useFactory: (
        db: FleetDb,
        repo: PasskeyCredentialRepository,
        store: ChallengeStorePort,
        config: ConfigService,
      ): PasskeyRegistrationService => {
        const rpId = config.get<string>('PASSKEY_RP_ID') ?? 'localhost';
        const rpName = config.get<string>('PASSKEY_RP_NAME') ?? 'Fleet';
        const lookupDriver: DriverLookupFn = async (operatorId) => {
          const rows = await db.select().from(driver).where(eq(driver.operatorId, operatorId)).limit(1);
          const r = rows[0];
          if (r === undefined) return null;
          return {
            driverId: r.driverId,
            companyId: r.companyId,
            businessUnitId: r.businessUnitId,
            depotId: r.depotId,
            legalEntityId: r.legalEntityId,
            operatorId: r.operatorId,
            active: r.active,
          };
        };
        const genOpts: GenerateRegistrationOptionsFn = (input) => swaGenReg({
          rpID: input.rpID,
          rpName: input.rpName,
          userID: input.userID as never,
          userName: input.userName,
          userDisplayName: input.userDisplayName,
          excludeCredentials: input.excludeCredentials.map((c) => ({ id: c.id, transports: c.transports as never })),
          attestationType: 'none',
          authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
        }) as never;
        const verifyResp: VerifyRegistrationResponseFn = (input) => swaVerifyReg({
          response: input.response as never,
          expectedChallenge: input.expectedChallenge,
          expectedRPID: input.expectedRPID,
          expectedOrigin: input.expectedOrigin,
        }) as never;
        return new PasskeyRegistrationService(lookupDriver, genOpts, verifyResp, repo, store, {
          rpId, rpName, maxCredentialsPerDriver: 10,
        });
      },
    },
    {
      provide: PasskeyAuthenticationService,
      inject: [DRIZZLE_DB, PasskeyCredentialRepository, CHALLENGE_STORE, ConfigService],
      useFactory: (
        db: FleetDb,
        repo: PasskeyCredentialRepository,
        store: ChallengeStorePort,
        config: ConfigService,
      ): PasskeyAuthenticationService => {
        const rpId = config.get<string>('PASSKEY_RP_ID') ?? 'localhost';
        const lookupByCred: CredentialLookupFn = async (credentialIdBuf) => {
          const rows = await db.select({
            driverId: driver.driverId,
            companyId: driver.companyId,
            businessUnitId: driver.businessUnitId,
            depotId: driver.depotId,
            legalEntityId: driver.legalEntityId,
            operatorId: driver.operatorId,
            active: driver.active,
            storedSignCount: passkeyCredential.signCount,
          }).from(passkeyCredential)
            .innerJoin(driver, eq(driver.driverId, passkeyCredential.driverId))
            .where(eq(passkeyCredential.credentialId, credentialIdBuf))
            .limit(1);
          const r = rows[0];
          if (r === undefined) return null;
          return {
            driverId: r.driverId, companyId: r.companyId, businessUnitId: r.businessUnitId,
            depotId: r.depotId, legalEntityId: r.legalEntityId, operatorId: r.operatorId,
            active: r.active, storedSignCount: r.storedSignCount,
          };
        };
        const genOpts: GenerateAuthenticationOptionsFn = (input) =>
          swaGenAuth({ rpID: input.rpID, userVerification: 'preferred' }) as never;
        const verifyResp: VerifyAuthenticationResponseFn = (input) =>
          swaVerifyAuth({
            response: input.response as never,
            expectedChallenge: input.expectedChallenge,
            expectedRPID: input.expectedRPID,
            expectedOrigin: input.expectedOrigin,
            credential: {
              id: input.credential.id,
              publicKey: input.credential.publicKey as never,
              counter: input.credential.counter,
              transports: input.credential.transports as never,
            },
          }) as never;
        return new PasskeyAuthenticationService(lookupByCred, genOpts, verifyResp, repo, store, { rpId });
      },
    },
  ],
  exports: [IDENTITY_PROVIDER, JwtGuard, OperatorContextFactory],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AuthModule {}
