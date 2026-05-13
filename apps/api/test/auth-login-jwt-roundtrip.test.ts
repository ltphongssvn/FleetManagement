// apps/api/test/auth-login-jwt-roundtrip.test.ts
// RED: A token issued by /auth/login must be verifiable by JoseIdentityProvider.
import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT, generateKeyPair, exportSPKI, type CryptoKey } from 'jose';
import { JoseIdentityProvider } from '../src/auth/jose-identity-provider.js';
import type { ConfigService } from '@nestjs/config';

// Test-only key pair generated at runtime so no PEM is committed.
let PUBLIC_PEM = '';

describe('JWT round-trip: login signer → JoseIdentityProvider verifier', () => {
  let provider: JoseIdentityProvider;
  let privateKey: CryptoKey;

  beforeAll(async () => {
    const kp = await generateKeyPair('ES256');
    privateKey = kp.privateKey;
    PUBLIC_PEM = await exportSPKI(kp.publicKey);
    const config = {
      getOrThrow: (k: string): string => ({
        JWT_ISSUER: 'fleet-pilot-api',
        JWT_AUDIENCE: 'fleet-driver',
        JWT_PUBLIC_KEY_PEM: PUBLIC_PEM,
      }[k] ?? ''),
    } as unknown as ConfigService;
    provider = new JoseIdentityProvider(config);
    await provider.onModuleInit();
  });

  it('verifies token issued by AuthLoginService format', async () => {
    const token = await new SignJWT({
      company_id: '00000000-0000-0000-0000-000000000000',
      business_unit_id: '00000000-0000-0000-0000-000000000000',
      depot_id: '00000000-0000-0000-0000-000000000000',
      legal_entity_id: '00000000-0000-0000-0000-000000000000',
      driver_id: 'd1',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'fleet-api-1' })
      .setIssuedAt()
      .setIssuer('fleet-pilot-api')
      .setAudience('fleet-driver')
      .setSubject('00000000-0000-0000-0000-000000000001')
      .setExpirationTime('24h')
      .sign(privateKey);

    const identity = await provider.verifyToken(token);
    expect(identity.subject).toBe('00000000-0000-0000-0000-000000000001');
    expect(identity.operatorId).toBe('00000000-0000-0000-0000-000000000001');
    expect(identity.companyId).toBe('00000000-0000-0000-0000-000000000000');
  });
});
