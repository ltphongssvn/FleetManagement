// apps/api/test/passkey.module-wiring.test.ts
// RED: AuthModule must wire PasskeyController + its services so DI resolves at boot.
// Black-box test: compile the module and assert the controller is registered.
// Generates a real ES256 keypair so JoseIdentityProvider + AuthLoginService factories succeed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync } from 'node:crypto';
import { AuthModule } from '../src/auth/auth.module.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '../src/config/env.config.js';
import { PasskeyController } from '../src/auth/passkey.controller.js';

function makePems(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

describe('AuthModule wires PasskeyController', () => {
  const saved: Record<string, string | undefined> = {};
  const ENV: Record<string, string> = {
    DATABASE_URL: 'postgres://localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    OIDC_ISSUER: 'https://example.com',
    OIDC_AUDIENCE: 'fleet-api',
    OIDC_JWKS_URI: 'https://example.com/.well-known/jwks.json',
  };
  beforeAll(() => {
    const { privatePem, publicPem } = makePems();
    ENV['JWT_PRIVATE_KEY_PEM'] = privatePem;
    ENV['JWT_PUBLIC_KEY_PEM'] = publicPem;
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterAll(() => {
    for (const k of Object.keys(ENV)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- restoring env vars in test teardown
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('resolves PasskeyController via Nest DI', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, ignoreEnvFile: true }),
        DatabaseModule,
        AuthModule,
      ],
    }).compile();
    const ctrl = moduleRef.get(PasskeyController);
    expect(ctrl).toBeInstanceOf(PasskeyController);
    await moduleRef.close();
  });
});
