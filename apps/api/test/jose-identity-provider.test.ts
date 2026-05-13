// apps/api/test/jose-identity-provider.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJwtVerify = vi.fn();
const mockImportSPKI = vi.fn().mockResolvedValue('mock-key');
vi.mock('jose', () => ({
  jwtVerify: mockJwtVerify,
  importSPKI: mockImportSPKI,
}));

const { JoseIdentityProvider } = await import('../src/auth/jose-identity-provider.js');

const fakeConfig = {
  getOrThrow: vi.fn((key: string) => {
    if (key === 'JWT_ISSUER') return 'fleet-pilot-api';
    if (key === 'JWT_AUDIENCE') return 'fleet-driver';
    if (key === 'JWT_PUBLIC_KEY_PEM') return '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----';
    throw new Error('unknown: ' + key);
  }),
} as never;

describe('@fleet/api - JoseIdentityProvider', () => {
  beforeEach(() => {
    mockJwtVerify.mockReset();
  });

  it('verifies a token and returns VerifiedIdentity with all claims', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: {
        sub: 'op-1',
        company_id: 'co-1',
        iat: 1700000000,
        exp: 1700003600,
      },
    });
    const provider = new JoseIdentityProvider(fakeConfig);
    await provider.onModuleInit();
    const result = await provider.verifyToken('eyJabc');
    expect(result.subject).toBe('op-1');
    expect(result.operatorId).toBe('op-1');
    expect(result.companyId).toBe('co-1');
    expect(result.issuedAt).toBe(1700000000);
    expect(result.expiresAt).toBe(1700003600);
  });

  it('throws when jwtVerify rejects', async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error('expired'));
    const provider = new JoseIdentityProvider(fakeConfig);
    await provider.onModuleInit();
    await expect(provider.verifyToken('eyJexp')).rejects.toThrow(/expired/);
  });

  it('throws when iat is missing', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'op-2', company_id: 'co-2', exp: 1700003600 },
    });
    const provider = new JoseIdentityProvider(fakeConfig);
    await provider.onModuleInit();
    await expect(provider.verifyToken('eyJnoiat')).rejects.toThrow(/iat\/exp/);
  });

  it('throws when exp is missing', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'op-3', company_id: 'co-3', iat: 1700000000 },
    });
    const provider = new JoseIdentityProvider(fakeConfig);
    await provider.onModuleInit();
    await expect(provider.verifyToken('eyJnoexp')).rejects.toThrow(/iat\/exp/);
  });

  it('throws when company_id is missing', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'op-4', iat: 1700000000, exp: 1700003600 },
    });
    const provider = new JoseIdentityProvider(fakeConfig);
    await provider.onModuleInit();
    await expect(provider.verifyToken('eyJnocom')).rejects.toThrow(/company_id/);
  });
});
