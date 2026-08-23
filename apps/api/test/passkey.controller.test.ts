// apps/api/test/passkey.controller.test.ts
/* eslint-disable @typescript-eslint/unbound-method -- vitest mock method references are safe */
// RED: PasskeyController exposes 4 endpoints:
//   POST /auth/passkey/register/options        -> begin registration (requires JWT)
//   POST /auth/passkey/register/verify         -> finish registration (requires JWT)
//   POST /auth/passkey/authenticate/options    -> begin auth (anonymous)
//   POST /auth/passkey/authenticate/verify     -> finish auth, returns accessToken
// Auth endpoints return LoginResult (same shape as password login) so clients reuse code.
// OperatorContext only carries operatorId + tenancy — driverId is resolved server-side by
// PasskeyRegistrationService via injected lookupDriver, given operatorId.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PasskeyController } from '../src/auth/passkey.controller.js';
import type { PasskeyRegistrationService } from '../src/auth/passkey-registration.service.js';
import type { PasskeyAuthenticationService } from '../src/auth/passkey-authentication.service.js';
import type { SignJwtFn } from '../src/auth/auth-login.service.js';
import type { RefreshTokenService } from '../src/auth/refresh-token.service.js';
import type { OperatorContext } from '@fleet/domain';

const OPERATOR: OperatorContext = {
  operatorId: '66666666-6666-6666-6666-666666666666',
  companyId: '22222222-2222-2222-2222-222222222222',
  businessUnitId: '33333333-3333-3333-3333-333333333333',
  depotId: '44444444-4444-4444-4444-444444444444',
  legalEntityId: '55555555-5555-5555-5555-555555555555',
};

const CLAIMS = {
  sub: OPERATOR.operatorId,
  companyId: OPERATOR.companyId,
  businessUnitId: OPERATOR.businessUnitId,
  depotId: OPERATOR.depotId,
  legalEntityId: OPERATOR.legalEntityId,
  driverId: '11111111-1111-1111-1111-111111111111',
};

describe('PasskeyController', () => {
  let regSvc: PasskeyRegistrationService;
  let authSvc: PasskeyAuthenticationService;
  let signJwt: SignJwtFn;
  let issueForLogin: ReturnType<typeof vi.fn>;
  let refreshTokens: RefreshTokenService;
  let ctrl: PasskeyController;

  beforeEach(() => {
    regSvc = {
      beginRegistration: vi.fn().mockResolvedValue({ challenge: 'reg-chal' }),
      finishRegistration: vi.fn().mockResolvedValue({ verified: true }),
    } as unknown as PasskeyRegistrationService;
    authSvc = {
      beginAuthentication: vi
        .fn()
        .mockResolvedValue({ challenge: 'auth-chal', rpId: 'fleet.example', timeout: 60000 }),
      finishAuthentication: vi.fn().mockResolvedValue({ claims: CLAIMS }),
    } as unknown as PasskeyAuthenticationService;
    signJwt = vi.fn().mockResolvedValue('signed.jwt.token');
    issueForLogin = vi.fn().mockResolvedValue({ refreshToken: 'r'.repeat(64), familyId: 'fam-1' });
    refreshTokens = { issueForLogin, accessTtlSeconds: 900 } as unknown as RefreshTokenService;
    ctrl = new PasskeyController(regSvc, authSvc, signJwt, refreshTokens);
  });

  describe('register/options', () => {
    it('delegates to regSvc.beginRegistration with operatorId', async () => {
      const r = await ctrl.beginRegister(OPERATOR);
      expect(regSvc.beginRegistration).toHaveBeenCalledWith(OPERATOR.operatorId);
      expect(r.challenge).toBe('reg-chal');
    });
  });

  describe('register/verify', () => {
    it('delegates to regSvc.finishRegistration with operatorId and body', async () => {
      const body = { id: 'cred-id', response: { attestationObject: 'x' } };
      const r = await ctrl.finishRegister(OPERATOR, body);
      expect(regSvc.finishRegistration).toHaveBeenCalledWith(OPERATOR.operatorId, body);
      expect(r.verified).toBe(true);
    });
  });

  describe('authenticate/options', () => {
    it('returns challenge anonymously', async () => {
      const r = await ctrl.beginAuth();
      expect(authSvc.beginAuthentication).toHaveBeenCalled();
      expect(r.challenge).toBe('auth-chal');
    });
  });

  describe('authenticate/verify', () => {
    it('finishes assertion, signs JWT, returns LoginResult', async () => {
      const body = { id: 'cred-id', response: { authenticatorData: 'x' }, challenge: 'auth-chal' };
      const r = await ctrl.finishAuth(body);
      expect(authSvc.finishAuthentication).toHaveBeenCalledWith(body, 'auth-chal');
      expect(signJwt).toHaveBeenCalledWith(CLAIMS);
      expect(r).toEqual({
        accessToken: 'signed.jwt.token',
        refreshToken: 'r'.repeat(64),
        expiresIn: 900,
        driver: { driverId: CLAIMS.driverId, operatorId: CLAIMS.sub },
      });
      expect(issueForLogin).toHaveBeenCalledWith(CLAIMS, expect.any(Number));
    });

    it('rejects body missing challenge field via zod', async () => {
      await expect(ctrl.finishAuth({ id: 'cred-id' } as never)).rejects.toThrow();
    });

    it('rejects body missing id via zod', async () => {
      await expect(ctrl.finishAuth({ challenge: 'auth-chal' } as never)).rejects.toThrow();
    });
  });
});
