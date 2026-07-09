// apps/api/src/auth/auth-login.service.ts
// Driver phone+password login. Success now issues the RFC 9700 rotated pair
// via RefreshTokenService; the result type IS the @fleet/sync-protocol
// DriverLoginResponse SSOT (Axis 2: the hand-written LoginResult shape is
// deleted, LoginResult remains only as an alias for existing importers).
import { and, eq } from 'drizzle-orm';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import type { DriverLoginResponse } from '@fleet/sync-protocol';
import type { FleetDb } from '../database/database.module.js';
import { driver } from '../database/schema/reference.js';
import { decideLoginOutcome, type LoginCandidate, type LoginClaims } from './auth-login-policy.js';
import type { RefreshTokenService } from './refresh-token.service.js';

export type LoginResult = DriverLoginResponse;
export type BcryptCompareFn = (plain: string, hash: string) => Promise<boolean>;
export type SignJwtFn = (claims: LoginClaims) => Promise<string>;

export class AuthLoginService {
  constructor(
    private readonly db: FleetDb,
    private readonly bcryptCompare: BcryptCompareFn,
    private readonly signJwt: SignJwtFn,
    private readonly companyId: string,
    private readonly refreshTokens: RefreshTokenService,
    private readonly accessTtlSeconds: number,
  ) {}

  async login(phone: string, password: string): Promise<LoginResult> {
    const rows = await this.db.select().from(driver)
      .where(and(eq(driver.phone, phone), eq(driver.companyId, this.companyId)))
      .limit(1);
    const row = rows[0];
    const candidate: LoginCandidate | null = row && row.passwordHash !== null ? {
      driverId: row.driverId,
      companyId: row.companyId,
      businessUnitId: row.businessUnitId,
      depotId: row.depotId,
      legalEntityId: row.legalEntityId,
      operatorId: row.operatorId,
      passwordHash: row.passwordHash,
      active: row.active,
    } : null;
    const passwordMatches = candidate !== null ? await this.bcryptCompare(password, candidate.passwordHash) : false;
    const outcome = decideLoginOutcome(candidate, passwordMatches);
    switch (outcome.kind) {
      case 'not-found':
      case 'invalid-password':
        throw new UnauthorizedException('unauthorized');
      case 'disabled':
        throw new ForbiddenException('disabled');
      case 'missing-operator':
        throw new UnauthorizedException('unauthorized: missing operator binding');
      case 'ok': {
        const accessToken = await this.signJwt(outcome.claims);
        const issued = await this.refreshTokens.issueForLogin(outcome.claims, Date.now());
        return {
          accessToken,
          refreshToken: issued.refreshToken,
          expiresIn: this.accessTtlSeconds,
          driver: { driverId: outcome.claims.driverId, operatorId: outcome.claims.sub },
        };
      }
    }
  }
}
