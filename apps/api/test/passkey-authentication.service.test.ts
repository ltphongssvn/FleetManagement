// apps/api/test/passkey-authentication.service.test.ts
/* eslint-disable @typescript-eslint/unbound-method -- vitest mock method references are safe */
// RED: PasskeyAuthenticationService orchestrates:
//   1) beginAuthentication() — produces challenge for client (usernameless flow OK)
//   2) finishAuthentication() — verifies assertion, updates sign_count, returns LoginClaims
// Returns the same shape as AuthLoginService.login so the controller can reuse signJwt.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import {
  PasskeyAuthenticationService,
  type CredentialLookupFn,
  type GenerateAuthenticationOptionsFn,
  type VerifyAuthenticationResponseFn,
  type ChallengeStore,
} from '../src/auth/passkey-authentication.service.js';
import type { PasskeyCredentialRepository } from '../src/auth/passkey-credential.repository.js';

const DRIVER = {
  driverId: '11111111-1111-1111-1111-111111111111',
  companyId: '22222222-2222-2222-2222-222222222222',
  businessUnitId: '33333333-3333-3333-3333-333333333333',
  depotId: '44444444-4444-4444-4444-444444444444',
  legalEntityId: '55555555-5555-5555-5555-555555555555',
  operatorId: '66666666-6666-6666-6666-666666666666',
  active: true,
  storedSignCount: 5,
};

const CRED_ID_B64URL = 'Y3JlZC1pZA';
const CRED_ID_BUF = Buffer.from(CRED_ID_B64URL, 'base64url');

function makeRepo(overrides: Partial<PasskeyCredentialRepository> = {}): PasskeyCredentialRepository {
  return {
    insert: vi.fn(),
    findByCredentialId: vi.fn().mockResolvedValue(null),
    credentialIdExists: vi.fn(),
    countByDriverId: vi.fn(),
    updateSignCountAndLastUsed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as PasskeyCredentialRepository;
}

function makeStore(): ChallengeStore {
  const m = new Map<string, string>();
  return {
    put: vi.fn((k: string, v: string) => { m.set(k, v); return Promise.resolve(); }),
    take: vi.fn((k: string) => { const v = m.get(k); m.delete(k); return Promise.resolve(v ?? null); }),
  };
}

describe('PasskeyAuthenticationService', () => {
  let lookupByCred: CredentialLookupFn;
  let genOpts: GenerateAuthenticationOptionsFn;
  let verifyResp: VerifyAuthenticationResponseFn;
  let repo: PasskeyCredentialRepository;
  let store: ChallengeStore;

  beforeEach(() => {
    lookupByCred = vi.fn().mockResolvedValue(DRIVER);
    genOpts = vi.fn().mockResolvedValue({
      challenge: 'auth-chal-b64url',
      rpId: 'fleet.example',
      timeout: 60000,
    });
    verifyResp = vi.fn().mockResolvedValue({
      verified: true,
      authenticationInfo: {
        newCounter: 6,
        credentialID: CRED_ID_B64URL,
      },
    });
    repo = makeRepo({
      findByCredentialId: vi.fn().mockResolvedValue({
        driverId: DRIVER.driverId,
        publicKey: Buffer.from([1, 2, 3]),
        signCount: 5,
        transports: 'internal',
      }),
    } as Partial<PasskeyCredentialRepository>);
    store = makeStore();
  });

  function svc(): PasskeyAuthenticationService {
    return new PasskeyAuthenticationService(lookupByCred, genOpts, verifyResp, repo, store, {
      rpId: 'fleet.example',
    });
  }

  describe('beginAuthentication', () => {
    it('returns options + stores challenge keyed by challenge value (usernameless)', async () => {
      const opts = await svc().beginAuthentication();
      expect(opts.challenge).toBe('auth-chal-b64url');
      expect(store.put).toHaveBeenCalledWith('auth-chal-b64url', 'auth-chal-b64url');
    });
  });

  describe('finishAuthentication', () => {
    it('verifies, updates sign_count, returns LoginClaims', async () => {
      const s = svc();
      await s.beginAuthentication();
      const result = await s.finishAuthentication({ id: CRED_ID_B64URL, response: { clientDataJSON: 'auth-chal-b64url' } } as never, 'auth-chal-b64url');
      expect(result.claims).toEqual({
        sub: DRIVER.operatorId,
        companyId: DRIVER.companyId,
        businessUnitId: DRIVER.businessUnitId,
        depotId: DRIVER.depotId,
        legalEntityId: DRIVER.legalEntityId,
        driverId: DRIVER.driverId,
      });
      expect(repo.updateSignCountAndLastUsed).toHaveBeenCalledWith(CRED_ID_BUF, 6);
    });

    it('throws 401 when no stored challenge', async () => {
      await expect(svc().finishAuthentication({} as never, 'unknown-chal'))
        .rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws 401 when @simplewebauthn verification fails', async () => {
      verifyResp = vi.fn().mockResolvedValue({ verified: false });
      const s = svc();
      await s.beginAuthentication();
      await expect(s.finishAuthentication({ id: CRED_ID_B64URL } as never, 'auth-chal-b64url'))
        .rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws 401 when credential lookup returns null (credential-not-found)', async () => {
      lookupByCred = vi.fn().mockResolvedValue(null);
      const s = svc();
      await s.beginAuthentication();
      await expect(s.finishAuthentication({ id: CRED_ID_B64URL } as never, 'auth-chal-b64url'))
        .rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws 403 when driver inactive', async () => {
      lookupByCred = vi.fn().mockResolvedValue({ ...DRIVER, active: false });
      const s = svc();
      await s.beginAuthentication();
      await expect(s.finishAuthentication({ id: CRED_ID_B64URL } as never, 'auth-chal-b64url'))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws 401 (cloned-authenticator) when newCounter <= storedSignCount and stored > 0', async () => {
      verifyResp = vi.fn().mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 5, credentialID: CRED_ID_B64URL },
      });
      const s = svc();
      await s.beginAuthentication();
      await expect(s.finishAuthentication({ id: CRED_ID_B64URL } as never, 'auth-chal-b64url'))
        .rejects.toBeInstanceOf(UnauthorizedException);
      expect(repo.updateSignCountAndLastUsed).not.toHaveBeenCalled();
    });

    it('challenge is single-use', async () => {
      const s = svc();
      await s.beginAuthentication();
      await s.finishAuthentication({ id: CRED_ID_B64URL } as never, 'auth-chal-b64url');
      await expect(s.finishAuthentication({ id: CRED_ID_B64URL } as never, 'auth-chal-b64url'))
        .rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws 401 when repo.findByCredentialId returns null (line 79 credential_not_found)', async () => {
      repo = makeRepo({ findByCredentialId: vi.fn().mockResolvedValue(null) } as Partial<PasskeyCredentialRepository>);
      const s = svc();
      await s.beginAuthentication();
      await expect(s.finishAuthentication({ id: CRED_ID_B64URL } as never, 'auth-chal-b64url'))
        .rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('handles a stored credential with null transports (lines 81-83 else arm)', async () => {
      repo = makeRepo({
        findByCredentialId: vi.fn().mockResolvedValue({
          driverId: DRIVER.driverId,
          publicKey: Buffer.from([1, 2, 3]),
          signCount: 5,
          transports: null,
        }),
      } as Partial<PasskeyCredentialRepository>);
      const s = svc();
      await s.beginAuthentication();
      const result = await s.finishAuthentication({ id: CRED_ID_B64URL, response: { clientDataJSON: 'auth-chal-b64url' } } as never, 'auth-chal-b64url');
      expect(result.claims.sub).toBe(DRIVER.operatorId);
    });
  });
});
