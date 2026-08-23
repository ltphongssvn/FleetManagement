// apps/api/test/jose-identity-provider.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJwtVerify = vi.fn();
const mockImportSPKI = vi.fn().mockResolvedValue('mock-self-key');
const mockRemoteJwks = vi.fn();
const mockCreateRemoteJWKSet = vi.fn(() => mockRemoteJwks);
const mockDecodeJwt = vi.fn();

vi.mock('jose', () => ({
  jwtVerify: mockJwtVerify,
  importSPKI: mockImportSPKI,
  createRemoteJWKSet: mockCreateRemoteJWKSet,
  decodeJwt: mockDecodeJwt,
}));

const { JoseIdentityProvider } = await import('../src/auth/jose-identity-provider.js');

const SELF_ISSUER = 'fleet-pilot-api';
const OIDC_ISSUER = 'http://mock-oauth2:8080/fleet';

// Fake ConfigService: getOrThrow for required keys, get for optionals.
function makeConfig(opts: { publicPem?: string | undefined } = { publicPem: 'PEM' }): never {
  return {
    getOrThrow: vi.fn((key: string) => {
      if (key === 'JWT_ISSUER') return SELF_ISSUER;
      if (key === 'JWT_AUDIENCE') return 'fleet-driver';
      if (key === 'OIDC_ISSUER') return OIDC_ISSUER;
      if (key === 'OIDC_AUDIENCE') return 'fleet-pilot';
      if (key === 'OIDC_JWKS_URI') return 'http://mock-oauth2:8080/fleet/jwks';
      throw new Error('unknown getOrThrow key: ' + key);
    }),
    get: vi.fn((key: string) => {
      if (key === 'JWT_PUBLIC_KEY_PEM') return opts.publicPem;
      return undefined;
    }),
  } as never;
}

const VALID = { sub: 'op-1', company_id: 'co-1', iat: 1700000000, exp: 1700003600 };

describe('@fleet/api - JoseIdentityProvider (dual-issuer)', () => {
  beforeEach(() => {
    mockJwtVerify.mockReset();
    mockDecodeJwt.mockReset();
    mockCreateRemoteJWKSet.mockClear();
    mockImportSPKI.mockClear();
  });

  it('verifies a self-issued token via the static public key', async () => {
    mockDecodeJwt.mockReturnValueOnce({ iss: SELF_ISSUER });
    mockJwtVerify.mockResolvedValueOnce({ payload: VALID });
    const provider = new JoseIdentityProvider(makeConfig());
    await provider.onModuleInit();
    const result = await provider.verifyToken('eyJself');
    expect(result.subject).toBe('op-1');
    expect(result.operatorId).toBe('op-1');
    expect(result.companyId).toBe('co-1');
    expect(result.issuedAt).toBe(1700000000);
    expect(result.expiresAt).toBe(1700003600);
    // self path used the imported SPKI key, not the JWKS
    expect(mockJwtVerify).toHaveBeenCalledWith(
      'eyJself',
      'mock-self-key',
      expect.objectContaining({ issuer: SELF_ISSUER }),
    );
  });

  it('verifies an OIDC token via the remote JWKS', async () => {
    mockDecodeJwt.mockReturnValueOnce({ iss: OIDC_ISSUER });
    mockJwtVerify.mockResolvedValueOnce({
      payload: {
        sub: 'oidc-sub',
        operator_id: 'op-9',
        company_id: 'co-9',
        iat: 1700000000,
        exp: 1700003600,
      },
    });
    const provider = new JoseIdentityProvider(makeConfig());
    await provider.onModuleInit();
    const result = await provider.verifyToken('eyJoidc');
    expect(result.subject).toBe('oidc-sub');
    expect(result.operatorId).toBe('op-9');
    expect(result.companyId).toBe('co-9');
    // OIDC path used the remote JWKS getter, with the OIDC issuer/audience
    expect(mockJwtVerify).toHaveBeenCalledWith(
      'eyJoidc',
      mockRemoteJwks,
      expect.objectContaining({ issuer: OIDC_ISSUER, audience: 'fleet-pilot' }),
    );
  });

  it('rejects a token whose issuer is neither trusted issuer', async () => {
    mockDecodeJwt.mockReturnValueOnce({ iss: 'https://evil.example.com' });
    const provider = new JoseIdentityProvider(makeConfig());
    await provider.onModuleInit();
    await expect(provider.verifyToken('eyJevil')).rejects.toThrow(/not trusted/);
    expect(mockJwtVerify).not.toHaveBeenCalled();
  });

  it('rejects a self-issued token when no public key is configured', async () => {
    mockDecodeJwt.mockReturnValueOnce({ iss: SELF_ISSUER });
    const provider = new JoseIdentityProvider(makeConfig({ publicPem: undefined }));
    await provider.onModuleInit();
    await expect(provider.verifyToken('eyJself')).rejects.toThrow(
      /JWT_PUBLIC_KEY_PEM not configured/,
    );
  });

  it('throws when jwtVerify rejects', async () => {
    mockDecodeJwt.mockReturnValueOnce({ iss: SELF_ISSUER });
    mockJwtVerify.mockRejectedValueOnce(new Error('expired'));
    const provider = new JoseIdentityProvider(makeConfig());
    await provider.onModuleInit();
    await expect(provider.verifyToken('eyJexp')).rejects.toThrow(/expired/);
  });

  it('throws when iat is missing', async () => {
    mockDecodeJwt.mockReturnValueOnce({ iss: SELF_ISSUER });
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'op-2', company_id: 'co-2', exp: 1700003600 },
    });
    const provider = new JoseIdentityProvider(makeConfig());
    await provider.onModuleInit();
    await expect(provider.verifyToken('eyJnoiat')).rejects.toThrow('iat/exp');
  });

  it('throws when exp is missing', async () => {
    mockDecodeJwt.mockReturnValueOnce({ iss: SELF_ISSUER });
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'op-3', company_id: 'co-3', iat: 1700000000 },
    });
    const provider = new JoseIdentityProvider(makeConfig());
    await provider.onModuleInit();
    await expect(provider.verifyToken('eyJnoexp')).rejects.toThrow('iat/exp');
  });

  it('throws when company_id is missing', async () => {
    mockDecodeJwt.mockReturnValueOnce({ iss: SELF_ISSUER });
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'op-4', iat: 1700000000, exp: 1700003600 },
    });
    const provider = new JoseIdentityProvider(makeConfig());
    await provider.onModuleInit();
    await expect(provider.verifyToken('eyJnocom')).rejects.toThrow(/company_id/);
  });

  it('surfaces acr and amr claims from the verified token (RFC 9068)', async () => {
    mockDecodeJwt.mockReturnValueOnce({ iss: OIDC_ISSUER });
    mockJwtVerify.mockResolvedValueOnce({
      payload: {
        sub: 'op-5',
        operator_id: 'op-5',
        company_id: 'co-5',
        iat: 1700000000,
        exp: 1700003600,
        acr: 'aal2',
        amr: ['pwd', 'hwk'],
      },
    });
    const provider = new JoseIdentityProvider(makeConfig());
    await provider.onModuleInit();
    const result = await provider.verifyToken('eyJacr');
    expect(result.acr).toBe('aal2');
    expect(result.amr).toEqual(['pwd', 'hwk']);
  });

  it('leaves acr/amr undefined when the token omits them', async () => {
    mockDecodeJwt.mockReturnValueOnce({ iss: SELF_ISSUER });
    mockJwtVerify.mockResolvedValueOnce({ payload: VALID });
    const provider = new JoseIdentityProvider(makeConfig());
    await provider.onModuleInit();
    const result = await provider.verifyToken('eyJnoacr');
    expect(result.acr).toBeUndefined();
    expect(result.amr).toBeUndefined();
  });
  it('surfaces realm_access.roles from the verified token', async () => {
    mockDecodeJwt.mockReturnValueOnce({ iss: OIDC_ISSUER });
    mockJwtVerify.mockResolvedValueOnce({
      payload: {
        sub: 'op-6',
        operator_id: 'op-6',
        company_id: 'co-6',
        iat: 1700000000,
        exp: 1700003600,
        realm_access: { roles: ['fleet-owner', 'offline_access'] },
      },
    });
    const provider = new JoseIdentityProvider(makeConfig());
    await provider.onModuleInit();
    const result = await provider.verifyToken('eyJroles');
    expect(result.roles).toEqual(['fleet-owner', 'offline_access']);
  });
  it('leaves roles undefined when realm_access is absent', async () => {
    mockDecodeJwt.mockReturnValueOnce({ iss: SELF_ISSUER });
    mockJwtVerify.mockResolvedValueOnce({ payload: VALID });
    const provider = new JoseIdentityProvider(makeConfig());
    await provider.onModuleInit();
    const result = await provider.verifyToken('eyJnoroles');
    expect(result.roles).toBeUndefined();
  });
});
