// apps/api/test/refresh-token.service.test.ts
// RED spec (driver-app-security arc, Phase 3.2b): RefreshTokenService.
// IO shell around the pure rotation policy. Port-injected repository (house
// DI pattern); the atomic single-use claim lives behind the port so the
// service logic is provable with an in-memory fake. Invariants pinned:
// hash-at-rest, rotation replaces + links (replaced_by_token_hash), reuse
// revokes the whole family, expired rows are left untouched (not claimed),
// logout is a recorded revocation.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  RefreshTokenService,
  type RefreshTokenRepositoryPort,
  type RefreshTokenRecord,
} from '../src/auth/refresh-token.service.js';
import type { LoginClaims } from '../src/auth/auth-login-policy.js';

const NOW_MS = Date.parse('2026-07-06T12:00:00Z');
const ACCESS_TTL = 900;
const REFRESH_TTL = 2_592_000;
const CLAIMS: LoginClaims = {
  sub: '9f8b8d64-0d2a-4a6b-9c37-5a2b6f1d3e4c',
  companyId: '00000000-0000-0000-0000-000000000000',
  businessUnitId: '11111111-1111-1111-1111-111111111111',
  depotId: '22222222-2222-2222-2222-222222222222',
  legalEntityId: '33333333-3333-3333-3333-333333333333',
  driverId: '3b241101-e2bb-4255-8caf-4136c566a962',
};

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

class FakeRepo implements RefreshTokenRepositoryPort {
  rows: RefreshTokenRecord[] = [];
  driverActive = true;
  familyRevocations: { familyId: string; reason: string }[] = [];
  insert(row: RefreshTokenRecord): Promise<void> {
    this.rows.push({ ...row });
    return Promise.resolve();
  }
  claimForRotation(
    tokenHash: string,
    replacedByTokenHash: string,
    nowMs: number,
  ): Promise<RefreshTokenRecord | null> {
    const row = this.rows.find(
      (r) => r.tokenHash === tokenHash && r.revokedAt === null && r.expiresAt.getTime() > nowMs,
    );
    if (row === undefined) return Promise.resolve(null);
    row.revokedAt = new Date(nowMs);
    row.revokedReason = 'rotated';
    row.replacedByTokenHash = replacedByTokenHash;
    return Promise.resolve({ ...row, driverActive: this.driverActive });
  }
  findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const row = this.rows.find((r) => r.tokenHash === tokenHash);
    return Promise.resolve(row === undefined ? null : { ...row, driverActive: this.driverActive });
  }
  revokeFamily(familyId: string, reason: string, nowMs: number): Promise<void> {
    this.familyRevocations.push({ familyId, reason });
    for (const r of this.rows) {
      if (r.familyId === familyId && r.revokedAt === null) {
        r.revokedAt = new Date(nowMs);
        r.revokedReason = reason;
      }
    }
    return Promise.resolve();
  }
  revokeByTokenHash(tokenHash: string, reason: string, nowMs: number): Promise<void> {
    for (const r of this.rows) {
      if (r.tokenHash === tokenHash && r.revokedAt === null) {
        r.revokedAt = new Date(nowMs);
        r.revokedReason = reason;
      }
    }
    return Promise.resolve();
  }
}

describe('RefreshTokenService', () => {
  let repo: FakeRepo;
  let signJwt: ReturnType<typeof vi.fn>;
  let svc: RefreshTokenService;
  beforeEach(() => {
    repo = new FakeRepo();
    signJwt = vi.fn().mockResolvedValue('signed.access.jwt');
    svc = new RefreshTokenService(repo, signJwt as never, {
      accessTtlSeconds: ACCESS_TTL,
      refreshTtlSeconds: REFRESH_TTL,
    });
  });

  it('issueForLogin stores only the sha-256 hash and a fresh family, never the raw token', async () => {
    const issued = await svc.issueForLogin(CLAIMS, NOW_MS);
    expect(repo.rows).toHaveLength(1);
    const row = repo.rows[0];
    expect(row?.tokenHash).toBe(sha256(issued.refreshToken));
    expect(row?.tokenHash).not.toBe(issued.refreshToken);
    expect(row?.familyId).toMatch(/^[0-9a-f-]{36}$/);
    expect(row?.revokedAt).toBeNull();
    expect(row?.expiresAt.getTime()).toBe(NOW_MS + REFRESH_TTL * 1000);
    expect(row?.driverId).toBe(CLAIMS.driverId);
    expect(row?.operatorId).toBe(CLAIMS.sub);
  });

  it('rotate happy path returns a new pair and links old to new', async () => {
    const issued = await svc.issueForLogin(CLAIMS, NOW_MS);
    const out = await svc.rotate(issued.refreshToken, NOW_MS + 60_000);
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.accessToken).toBe('signed.access.jwt');
      expect(out.expiresIn).toBe(ACCESS_TTL);
      expect(out.refreshToken).not.toBe(issued.refreshToken);
      const oldRow = repo.rows.find((r) => r.tokenHash === sha256(issued.refreshToken));
      const newRow = repo.rows.find((r) => r.tokenHash === sha256(out.refreshToken));
      expect(oldRow?.revokedReason).toBe('rotated');
      expect(oldRow?.replacedByTokenHash).toBe(sha256(out.refreshToken));
      expect(newRow?.revokedAt).toBeNull();
      expect(newRow?.familyId).toBe(oldRow?.familyId);
    }
    expect(signJwt).toHaveBeenCalledWith(expect.objectContaining({ driverId: CLAIMS.driverId }));
  });

  it('rotate with an unknown token is not-found and mints nothing', async () => {
    const out = await svc.rotate('never-issued-token', NOW_MS);
    expect(out).toEqual({ kind: 'not-found' });
    expect(repo.rows).toHaveLength(0);
    expect(signJwt).not.toHaveBeenCalled();
  });

  it('replaying an already-rotated token is reuse: whole family revoked, nothing minted', async () => {
    const issued = await svc.issueForLogin(CLAIMS, NOW_MS);
    const first = await svc.rotate(issued.refreshToken, NOW_MS + 1000);
    expect(first.kind).toBe('ok');
    const rowCountAfterFirst = repo.rows.length;
    const replay = await svc.rotate(issued.refreshToken, NOW_MS + 2000);
    expect(replay.kind).toBe('reused');
    expect(repo.familyRevocations).toHaveLength(1);
    expect(repo.familyRevocations[0]?.reason).toBe('reuse-detected');
    expect(repo.rows).toHaveLength(rowCountAfterFirst);
    const rotatedChild = repo.rows.find((r) => r.revokedReason === 'reuse-detected');
    expect(rotatedChild).toBeDefined();
  });

  it('rotate with an expired live token is expired and the row is left unclaimed', async () => {
    const issued = await svc.issueForLogin(CLAIMS, NOW_MS);
    const past = NOW_MS + REFRESH_TTL * 1000 + 1;
    const out = await svc.rotate(issued.refreshToken, past);
    expect(out).toEqual({ kind: 'expired' });
    const row = repo.rows.find((r) => r.tokenHash === sha256(issued.refreshToken));
    expect(row?.revokedAt).toBeNull();
    expect(repo.rows).toHaveLength(1);
  });

  it('rotate for a disabled driver is driver-disabled and revokes the family fail-closed', async () => {
    const issued = await svc.issueForLogin(CLAIMS, NOW_MS);
    repo.driverActive = false;
    const out = await svc.rotate(issued.refreshToken, NOW_MS + 1000);
    expect(out).toEqual({ kind: 'driver-disabled' });
    expect(repo.familyRevocations[0]?.reason).toBe('driver-disabled');
    expect(repo.rows).toHaveLength(1);
  });

  it('revokeForLogout records a logout revocation for the presented token', async () => {
    const issued = await svc.issueForLogin(CLAIMS, NOW_MS);
    await svc.revokeForLogout(issued.refreshToken, NOW_MS + 500);
    const row = repo.rows.find((r) => r.tokenHash === sha256(issued.refreshToken));
    expect(row?.revokedReason).toBe('logout');
    expect(row?.revokedAt).not.toBeNull();
  });

  it('two sequential rotations chain the family across three rows', async () => {
    const issued = await svc.issueForLogin(CLAIMS, NOW_MS);
    const r1 = await svc.rotate(issued.refreshToken, NOW_MS + 1000);
    if (r1.kind !== 'ok') throw new Error('expected ok');
    const r2 = await svc.rotate(r1.refreshToken, NOW_MS + 2000);
    if (r2.kind !== 'ok') throw new Error('expected ok');
    const families = new Set(repo.rows.map((r) => r.familyId));
    expect(families.size).toBe(1);
    expect(repo.rows).toHaveLength(3);
    const live = repo.rows.filter((r) => r.revokedAt === null);
    expect(live).toHaveLength(1);
    expect(live[0]?.tokenHash).toBe(sha256(r2.refreshToken));
  });
});

describe('RefreshTokenService decideUnclaimed fallback (adapter anomalies)', () => {
  const NOW = Date.parse('2026-07-06T12:00:00Z');
  function liveRow(driverActive: boolean): RefreshTokenRecord {
    return {
      driverId: '3b241101-e2bb-4255-8caf-4136c566a962',
      companyId: '00000000-0000-0000-0000-000000000000',
      businessUnitId: '11111111-1111-1111-1111-111111111111',
      depotId: '22222222-2222-2222-2222-222222222222',
      legalEntityId: '33333333-3333-3333-3333-333333333333',
      operatorId: '9f8b8d64-0d2a-4a6b-9c37-5a2b6f1d3e4c',
      familyId: '44444444-4444-4444-4444-444444444444',
      tokenHash: 'x'.repeat(64),
      issuedAt: new Date(NOW - 1000),
      expiresAt: new Date(NOW + 86_400_000),
      revokedAt: null,
      revokedReason: null,
      replacedByTokenHash: null,
      driverActive,
    };
  }
  function stubRepo(
    found: RefreshTokenRecord | null,
  ): RefreshTokenRepositoryPort & { inserted: number } {
    const repo = {
      inserted: 0,
      insert(): Promise<void> {
        repo.inserted += 1;
        return Promise.resolve();
      },
      claimForRotation(): Promise<RefreshTokenRecord | null> {
        return Promise.resolve(null);
      },
      findByTokenHash(): Promise<RefreshTokenRecord | null> {
        return Promise.resolve(found);
      },
      revokeFamily(): Promise<void> {
        return Promise.resolve();
      },
      revokeByTokenHash(): Promise<void> {
        return Promise.resolve();
      },
    };
    return repo;
  }

  it('unclaimed but live row with a disabled driver resolves driver-disabled, mints nothing', async () => {
    const repo = stubRepo(liveRow(false));
    const signJwt = vi.fn();
    const svc = new RefreshTokenService(repo, signJwt as never, {
      accessTtlSeconds: 900,
      refreshTtlSeconds: 3600,
    });
    const out = await svc.rotate('presented-token', NOW);
    expect(out).toEqual({ kind: 'driver-disabled' });
    expect(repo.inserted).toBe(0);
    expect(signJwt).not.toHaveBeenCalled();
  });

  it('unclaimed yet policy-ok row fails closed to not-found, mints nothing', async () => {
    const repo = stubRepo(liveRow(true));
    const signJwt = vi.fn();
    const svc = new RefreshTokenService(repo, signJwt as never, {
      accessTtlSeconds: 900,
      refreshTtlSeconds: 3600,
    });
    const out = await svc.rotate('presented-token', NOW);
    expect(out).toEqual({ kind: 'not-found' });
    expect(repo.inserted).toBe(0);
    expect(signJwt).not.toHaveBeenCalled();
  });
});
