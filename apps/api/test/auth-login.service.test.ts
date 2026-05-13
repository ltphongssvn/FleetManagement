// apps/api/test/auth-login.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthLoginService } from '../src/auth/auth-login.service.js';

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

describe('AuthLoginService', () => {
  let bcryptCompare: ReturnType<typeof vi.fn>;
  let signJwt: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    bcryptCompare = vi.fn();
    signJwt = vi.fn().mockResolvedValue('signed.jwt.token');
  });

  it('returns 401 unauthorized for unknown phone', async () => {
    const svc = new AuthLoginService(makeDb([]) as never, bcryptCompare as unknown as (p: string, h: string) => Promise<boolean>, signJwt as never, TENANCY.companyId);
    await expect(svc.login('0900000000', 'pw')).rejects.toThrow(/unauthorized/i);
  });

  it('returns 401 unauthorized for wrong password', async () => {
    bcryptCompare.mockResolvedValue(false);
    const row: DriverRow = { driverId: 'd1', ...TENANCY, operatorId: 'op1', passwordHash: 'h', active: true, phone: '0900000001' };
    const svc = new AuthLoginService(makeDb([row]) as never, bcryptCompare as unknown as (p: string, h: string) => Promise<boolean>, signJwt as never, TENANCY.companyId);
    await expect(svc.login('0900000001', 'wrong')).rejects.toThrow(/unauthorized/i);
  });

  it('returns 403 forbidden when driver inactive', async () => {
    bcryptCompare.mockResolvedValue(true);
    const row: DriverRow = { driverId: 'd1', ...TENANCY, operatorId: 'op1', passwordHash: 'h', active: false, phone: '0900000001' };
    const svc = new AuthLoginService(makeDb([row]) as never, bcryptCompare as unknown as (p: string, h: string) => Promise<boolean>, signJwt as never, TENANCY.companyId);
    await expect(svc.login('0900000001', 'pw')).rejects.toThrow(/disabled/i);
  });

  it('returns signed JWT + driver context on success', async () => {
    bcryptCompare.mockResolvedValue(true);
    const row: DriverRow = { driverId: 'd1', ...TENANCY, operatorId: 'op1', passwordHash: 'h', active: true, phone: '0900000001' };
    const svc = new AuthLoginService(makeDb([row]) as never, bcryptCompare as unknown as (p: string, h: string) => Promise<boolean>, signJwt as never, TENANCY.companyId);
    const r = await svc.login('0900000001', 'pw');
    expect(r.accessToken).toBe('signed.jwt.token');
    expect(r.driver.driverId).toBe('d1');
    expect(signJwt).toHaveBeenCalledWith(expect.objectContaining({ sub: 'op1', driverId: 'd1' }));
  });
});
