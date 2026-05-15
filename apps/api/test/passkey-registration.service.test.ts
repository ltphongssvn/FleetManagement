// apps/api/test/passkey-registration.service.test.ts
// RED: PasskeyRegistrationService orchestrates:
//   1) generateRegistrationOptions() — produces challenge + RP config for client
//   2) verifyRegistrationResponse() — verifies attestation, persists credential
// Dependencies are injected (driverLookup, repo, generateOptions, verifyResponse,
// challengeStore) so we can unit-test without real WebAuthn crypto.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException, ForbiddenException, ConflictException } from '@nestjs/common';
import {
  PasskeyRegistrationService,
  type DriverLookupFn,
  type GenerateRegistrationOptionsFn,
  type VerifyRegistrationResponseFn,
  type ChallengeStore,
} from '../src/auth/passkey-registration.service.js';
import type { PasskeyCredentialRepository } from '../src/auth/passkey-credential.repository.js';

const DRIVER = {
  driverId: '11111111-1111-1111-1111-111111111111',
  companyId: '22222222-2222-2222-2222-222222222222',
  businessUnitId: '33333333-3333-3333-3333-333333333333',
  depotId: '44444444-4444-4444-4444-444444444444',
  legalEntityId: '55555555-5555-5555-5555-555555555555',
  operatorId: '66666666-6666-6666-6666-666666666666',
  active: true,
};

function makeRepo(overrides: Partial<PasskeyCredentialRepository> = {}): PasskeyCredentialRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    findByCredentialId: vi.fn().mockResolvedValue(null),
    credentialIdExists: vi.fn().mockResolvedValue(false),
    countByDriverId: vi.fn().mockResolvedValue(0),
    updateSignCountAndLastUsed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as PasskeyCredentialRepository;
}

function makeStore(): ChallengeStore {
  const m = new Map<string, string>();
  return {
    put: vi.fn(async (k: string, v: string) => { m.set(k, v); }),
    take: vi.fn(async (k: string) => { const v = m.get(k); m.delete(k); return v ?? null; }),
  };
}

describe('PasskeyRegistrationService', () => {
  let lookup: DriverLookupFn;
  let genOpts: GenerateRegistrationOptionsFn;
  let verifyResp: VerifyRegistrationResponseFn;
  let repo: PasskeyCredentialRepository;
  let store: ChallengeStore;

  beforeEach(() => {
    lookup = vi.fn().mockResolvedValue(DRIVER);
    genOpts = vi.fn().mockResolvedValue({
      challenge: 'chal-base64url',
      rp: { id: 'fleet.example', name: 'Fleet' },
      user: { id: 'u', name: 'n', displayName: 'd' },
      pubKeyCredParams: [],
    });
    verifyResp = vi.fn().mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'cred-id-b64url',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ['internal'],
        },
        aaguid: 'adce0002-35bc-c60a-648b-0b25f1f05503',
      },
    });
    repo = makeRepo();
    store = makeStore();
  });

  function svc(): PasskeyRegistrationService {
    return new PasskeyRegistrationService(lookup, genOpts, verifyResp, repo, store, {
      rpId: 'fleet.example',
      rpName: 'Fleet',
      maxCredentialsPerDriver: 10,
    });
  }

  describe('beginRegistration', () => {
    it('returns options + stores challenge for the driver', async () => {
      const opts = await svc().beginRegistration(DRIVER.driverId);
      expect(opts.challenge).toBe('chal-base64url');
      expect(store.put).toHaveBeenCalledWith(DRIVER.driverId, 'chal-base64url');
    });

    it('throws 401 when driver not found', async () => {
      lookup = vi.fn().mockResolvedValue(null);
      await expect(svc().beginRegistration('nope')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws 403 when driver inactive', async () => {
      lookup = vi.fn().mockResolvedValue({ ...DRIVER, active: false });
      await expect(svc().beginRegistration(DRIVER.driverId)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws 409 when driver already at credential limit', async () => {
      repo = makeRepo({ countByDriverId: vi.fn().mockResolvedValue(10) } as Partial<PasskeyCredentialRepository>);
      await expect(svc().beginRegistration(DRIVER.driverId)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('finishRegistration', () => {
    it('verifies response, persists credential, returns ok', async () => {
      await svc().beginRegistration(DRIVER.driverId);
      const result = await svc().finishRegistration(DRIVER.driverId, { id: 'cred-id-b64url' } as never);
      expect(result.verified).toBe(true);
      expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({
        driverId: DRIVER.driverId,
        signCount: 0,
        aaguid: 'adce0002-35bc-c60a-648b-0b25f1f05503',
        transports: 'internal',
      }));
    });

    it('throws 401 when no stored challenge for driver', async () => {
      await expect(svc().finishRegistration(DRIVER.driverId, {} as never))
        .rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws 401 when @simplewebauthn verification returns verified=false', async () => {
      verifyResp = vi.fn().mockResolvedValue({ verified: false });
      await svc().beginRegistration(DRIVER.driverId);
      await expect(svc().finishRegistration(DRIVER.driverId, {} as never))
        .rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws 409 when credentialId collides globally', async () => {
      repo = makeRepo({ credentialIdExists: vi.fn().mockResolvedValue(true) } as Partial<PasskeyCredentialRepository>);
      await svc().beginRegistration(DRIVER.driverId);
      await expect(svc().finishRegistration(DRIVER.driverId, {} as never))
        .rejects.toBeInstanceOf(ConflictException);
    });

    it('challenge is single-use (second finish call has no stored challenge)', async () => {
      const s = svc();
      await s.beginRegistration(DRIVER.driverId);
      await s.finishRegistration(DRIVER.driverId, { id: 'cred-id-b64url' } as never);
      await expect(s.finishRegistration(DRIVER.driverId, {} as never))
        .rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
