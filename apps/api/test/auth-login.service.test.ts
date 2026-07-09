// apps/api/test/auth-login.service.test.ts
// Extended (driver-app-security arc, Phase 3.4b): login now issues the RFC
// 9700 rotated pair. AuthLoginService gains the RefreshTokenService port and
// the access TTL; the success result must satisfy the sync-protocol
// DriverLoginResponse SSOT (accessToken + refreshToken + expiresIn + driver).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DriverLoginResponseSchema } from '@fleet/sync-protocol';
import { AuthLoginService } from '../src/auth/auth-login.service.js';
import type { RefreshTokenService } from '../src/auth/refresh-token.service.js';
interface DriverRow {
  driverId: string; companyId: string; businessUnitId: string; depotId: string; legalEntityId: string;
  operatorId: string | null; passwordHash: string | null; active: boolean; phone: string | null;
}
function makeDb(rows: DriverRow[]): unknown {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) }),
  };
}
const TENANCY = {
  companyId: '11111111-1111-1111-1111-111111111111',
  businessUnitId: '22222222-2222-2222-2222-222222222222',
  depotId: '33333333-3333-3333-3333-333333333333',
  legalEntityId: '44444444-4444-4444-4444-444444444444',
};
const D1 = '3b241101-e2bb-4255-8caf-4136c566a962';
const OP1 = '9f8b8d64-0d2a-4a6b-9c37-5a2b6f1d3e4c';
describe('AuthLoginService', () => {
  let bcryptCompare: ReturnType<typeof vi.fn>;
  let signJwt: ReturnType<typeof vi.fn>;
  let issueForLogin: ReturnType<typeof vi.fn>;
  let refreshTokens: RefreshTokenService;
  const ACCESS_TTL = 900;
  beforeEach(() => {
    bcryptCompare = vi.fn();
    signJwt = vi.fn().mockResolvedValue('signed.jwt.token');
    issueForLogin = vi.fn().mockResolvedValue({ refreshToken: 'r'.repeat(64), familyId: 'fam-1' });
    refreshTokens = { issueForLogin } as unknown as RefreshTokenService;
  });
  function makeSvc(rows: DriverRow[]): AuthLoginService {
    return new AuthLoginService(
      makeDb(rows) as never,
      bcryptCompare as unknown as (p: string, h: string) => Promise<boolean>,
      signJwt as never,
      TENANCY.companyId,
      refreshTokens,
      ACCESS_TTL,
    );
  }
  it('returns 401 unauthorized for unknown phone', async () => {
    const svc = makeSvc([]);
    await expect(svc.login('0900000000', 'pw')).rejects.toThrow(/unauthorized/i);
    expect(issueForLogin).not.toHaveBeenCalled();
  });
  it('returns 401 unauthorized for wrong password', async () => {
    bcryptCompare.mockResolvedValue(false);
    const row: DriverRow = { driverId: D1, ...TENANCY, operatorId: OP1, passwordHash: 'h', active: true, phone: '0900000001' };
    const svc = makeSvc([row]);
    await expect(svc.login('0900000001', 'wrong')).rejects.toThrow(/unauthorized/i);
    expect(issueForLogin).not.toHaveBeenCalled();
  });
  it('returns 403 forbidden when driver inactive', async () => {
    bcryptCompare.mockResolvedValue(true);
    const row: DriverRow = { driverId: D1, ...TENANCY, operatorId: OP1, passwordHash: 'h', active: false, phone: '0900000001' };
    const svc = makeSvc([row]);
    await expect(svc.login('0900000001', 'pw')).rejects.toThrow(/disabled/i);
    expect(issueForLogin).not.toHaveBeenCalled();
  });
  it('returns the rotated pair + driver context on success, satisfying the SSOT', async () => {
    bcryptCompare.mockResolvedValue(true);
    const row: DriverRow = { driverId: D1, ...TENANCY, operatorId: OP1, passwordHash: 'h', active: true, phone: '0900000001' };
    const svc = makeSvc([row]);
    const r = await svc.login('0900000001', 'pw');
    expect(r.accessToken).toBe('signed.jwt.token');
    expect(r.refreshToken).toBe('r'.repeat(64));
    expect(r.expiresIn).toBe(ACCESS_TTL);
    expect(r.driver.driverId).toBe(D1);
    expect(DriverLoginResponseSchema.safeParse(r).success).toBe(true);
    expect(signJwt).toHaveBeenCalledWith(expect.objectContaining({ sub: OP1, driverId: D1 }));
    expect(issueForLogin).toHaveBeenCalledWith(
      expect.objectContaining({ sub: OP1, driverId: D1 }),
      expect.any(Number),
    );
  });
});
