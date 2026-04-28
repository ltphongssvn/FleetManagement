// apps/api/test/jose-identity-provider.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJwtVerify = vi.fn();
vi.mock('jose', () => ({
  jwtVerify: mockJwtVerify,
  createRemoteJWKSet: vi.fn().mockReturnValue('mock-jwks'),
}));

const { JoseIdentityProvider } = await import('../src/auth/jose-identity-provider.js');

const fakeConfig = {
  getOrThrow: vi.fn((key: string) => {
    if (key === 'OIDC_ISSUER') return 'https://idp.example.com';
    if (key === 'OIDC_AUDIENCE') return 'fleet-api';
    if (key === 'OIDC_JWKS_URI') return 'https://idp.example.com/jwks';
    throw new Error('unknown');
  }),
} as never;

describe('@fleet/api - JoseIdentityProvider', () => {
  beforeEach(() => {
    mockJwtVerify.mockReset();
  });

  it('verifies a token and returns VerifiedIdentity with all claims', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: {
        sub: 'user-1',
        operator_id: 'op-1',
        company_id: 'co-1',
        iat: 1700000000,
        exp: 1700003600,
      },
    });
    const provider = new JoseIdentityProvider(fakeConfig);
    const result = await provider.verifyToken('eyJabc');
    expect(result.subject).toBe('user-1');
    expect(result.operatorId).toBe('op-1');
    expect(result.companyId).toBe('co-1');
    expect(result.issuedAt).toBe(1700000000);
    expect(result.expiresAt).toBe(1700003600);
  });

  it('throws when jwtVerify rejects', async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error('expired'));
    const provider = new JoseIdentityProvider(fakeConfig);
    await expect(provider.verifyToken('eyJexp')).rejects.toThrow(/expired/);
  });

  it('throws when iat is missing', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'user-2', operator_id: 'op-2', company_id: 'co-2', exp: 1700003600 },
    });
    const provider = new JoseIdentityProvider(fakeConfig);
    await expect(provider.verifyToken('eyJnoiat')).rejects.toThrow(/iat\/exp/);
  });

  it('throws when exp is missing', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'user-3', operator_id: 'op-3', company_id: 'co-3', iat: 1700000000 },
    });
    const provider = new JoseIdentityProvider(fakeConfig);
    await expect(provider.verifyToken('eyJnoexp')).rejects.toThrow(/iat\/exp/);
  });
});
