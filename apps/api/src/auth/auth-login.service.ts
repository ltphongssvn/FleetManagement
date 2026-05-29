// apps/api/src/auth/auth-login.service.ts
import { and, eq } from 'drizzle-orm';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import type { FleetDb } from '../database/database.module.js';
import { driver } from '../database/schema/reference.js';
import { decideLoginOutcome, type LoginCandidate, type LoginClaims } from './auth-login-policy.js';

export interface LoginResult {
  readonly accessToken: string;
  readonly driver: {
    readonly driverId: string;
    readonly operatorId: string;
    readonly fullName?: string;
  };
}

export type BcryptCompareFn = (plain: string, hash: string) => Promise<boolean>;
export type SignJwtFn = (claims: LoginClaims) => Promise<string>;

export class AuthLoginService {
  constructor(
    private readonly db: FleetDb,
    private readonly bcryptCompare: BcryptCompareFn,
    private readonly signJwt: SignJwtFn,
    private readonly companyId: string,
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
        return {
          accessToken,
          driver: { driverId: outcome.claims.driverId, operatorId: outcome.claims.sub },
        };
      }
    }
  }
}
