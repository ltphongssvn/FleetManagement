// apps/api/src/auth/refresh-token.service.ts
// RefreshTokenService: IO shell for RFC 9700 rotating refresh tokens.
// Pure decisions live in refresh-rotation-policy; this class owns token
// minting (crypto-random opaque tokens), hash-at-rest (sha-256 hex), the
// atomic rotation claim (behind the repository port, single-use via a
// conditional UPDATE in the real adapter), family reuse-revocation, and
// access-JWT minting via the injected signer. Rows are never deleted:
// every lifecycle change is a recorded revocation (audit trail).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { LoginClaims } from './auth-login-policy.js';
import { decideRotationOutcome, type RefreshCandidate } from './refresh-rotation-policy.js';

export interface RefreshTokenRecord {
  driverId: string;
  companyId: string;
  businessUnitId: string;
  depotId: string;
  legalEntityId: string;
  operatorId: string;
  familyId: string;
  tokenHash: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  replacedByTokenHash: string | null;
  driverActive: boolean;
}

export interface RefreshTokenRepositoryPort {
  insert(row: RefreshTokenRecord): Promise<void>;
  claimForRotation(tokenHash: string, replacedByTokenHash: string, nowMs: number): Promise<RefreshTokenRecord | null>;
  findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revokeFamily(familyId: string, reason: string, nowMs: number): Promise<void>;
  revokeByTokenHash(tokenHash: string, reason: string, nowMs: number): Promise<void>;
}

export interface RefreshTokenServiceOptions {
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;
}

export interface IssuedRefreshToken {
  readonly refreshToken: string;
  readonly familyId: string;
}

export type RotateOutcome =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'reused' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'driver-disabled' }
  | {
      readonly kind: 'ok';
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly expiresIn: number;
    };

export type SignAccessJwtFn = (claims: LoginClaims) => Promise<string>;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function mintOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

function claimsFromRecord(row: RefreshTokenRecord): LoginClaims {
  return {
    sub: row.operatorId,
    companyId: row.companyId,
    businessUnitId: row.businessUnitId,
    depotId: row.depotId,
    legalEntityId: row.legalEntityId,
    driverId: row.driverId,
  };
}

export class RefreshTokenService {
  constructor(
    private readonly repo: RefreshTokenRepositoryPort,
    private readonly signAccessJwt: SignAccessJwtFn,
    private readonly opts: RefreshTokenServiceOptions,
  ) {}

  async issueForLogin(claims: LoginClaims, nowMs: number): Promise<IssuedRefreshToken> {
    const refreshToken = mintOpaqueToken();
    const familyId = randomUUID();
    await this.repo.insert(this.buildRecord(claims, familyId, refreshToken, nowMs));
    return { refreshToken, familyId };
  }

  async rotate(presentedToken: string, nowMs: number): Promise<RotateOutcome> {
    const presentedHash = sha256Hex(presentedToken);
    const nextToken = mintOpaqueToken();
    const nextHash = sha256Hex(nextToken);
    const claimed = await this.repo.claimForRotation(presentedHash, nextHash, nowMs);
    if (claimed === null) {
      return this.decideUnclaimed(presentedHash, nowMs);
    }
    if (!claimed.driverActive) {
      await this.repo.revokeFamily(claimed.familyId, 'driver-disabled', nowMs);
      return { kind: 'driver-disabled' };
    }
    const claims = claimsFromRecord(claimed);
    await this.repo.insert(this.buildRecord(claims, claimed.familyId, nextToken, nowMs));
    const accessToken = await this.signAccessJwt(claims);
    return {
      kind: 'ok',
      accessToken,
      refreshToken: nextToken,
      expiresIn: this.opts.accessTtlSeconds,
    };
  }

  async revokeForLogout(presentedToken: string, nowMs: number): Promise<void> {
    await this.repo.revokeByTokenHash(sha256Hex(presentedToken), 'logout', nowMs);
  }

  private async decideUnclaimed(presentedHash: string, nowMs: number): Promise<RotateOutcome> {
    const row = await this.repo.findByTokenHash(presentedHash);
    const candidate: RefreshCandidate | null =
      row === null
        ? null
        : {
            driverId: row.driverId,
            companyId: row.companyId,
            businessUnitId: row.businessUnitId,
            depotId: row.depotId,
            legalEntityId: row.legalEntityId,
            operatorId: row.operatorId,
            familyId: row.familyId,
            expiresAt: row.expiresAt,
            revokedAt: row.revokedAt,
            driverActive: row.driverActive,
          };
    const outcome = decideRotationOutcome(candidate, nowMs);
    switch (outcome.kind) {
      case 'reused':
        await this.repo.revokeFamily(outcome.familyId, 'reuse-detected', nowMs);
        return { kind: 'reused' };
      case 'not-found':
        return { kind: 'not-found' };
      case 'expired':
        return { kind: 'expired' };
      case 'driver-disabled':
        return { kind: 'driver-disabled' };
      case 'ok':
        // Unreachable: a live, unexpired token would have been claimed.
        // Fail closed rather than mint outside the atomic claim.
        return { kind: 'not-found' };
    }
  }

  private buildRecord(claims: LoginClaims, familyId: string, token: string, nowMs: number): RefreshTokenRecord {
    return {
      driverId: claims.driverId,
      companyId: claims.companyId,
      businessUnitId: claims.businessUnitId,
      depotId: claims.depotId,
      legalEntityId: claims.legalEntityId,
      operatorId: claims.sub,
      familyId,
      tokenHash: sha256Hex(token),
      issuedAt: new Date(nowMs),
      expiresAt: new Date(nowMs + this.opts.refreshTtlSeconds * 1000),
      revokedAt: null,
      revokedReason: null,
      replacedByTokenHash: null,
      driverActive: true,
    };
  }
}
