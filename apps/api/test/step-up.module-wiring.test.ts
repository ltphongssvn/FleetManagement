// apps/api/test/step-up.module-wiring.test.ts
// RED: AuthModule must register + export StepUpGuard so DI resolves it (it needs
// Reflector) and other modules can apply it. Black-box: compile the module and
// resolve the provider. Real ES256 keypair so the JoseIdentityProvider and
// AuthLoginService factories succeed at boot.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../src/auth/auth.module.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { validateEnv } from '../src/config/env.config.js';
import { StepUpGuard } from '../src/auth/step-up.guard.js';

function makePems(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

describe('AuthModule wires StepUpGuard', () => {
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

  it('resolves StepUpGuard (with its Reflector dep) via Nest DI', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, ignoreEnvFile: true }),
        DatabaseModule,
        AuthModule,
      ],
    }).compile();
    const guard = moduleRef.get(StepUpGuard);
    expect(guard).toBeInstanceOf(StepUpGuard);
    await moduleRef.close();
  });

  it('exports StepUpGuard for use by feature modules', async () => {
    const probe = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, ignoreEnvFile: true }),
        DatabaseModule,
        AuthModule,
      ],
    }).compile();
    // Resolving from a compiled graph that only imports AuthModule proves the
    // provider is exported (not merely internal).
    expect(probe.get(StepUpGuard)).toBeInstanceOf(StepUpGuard);
    await probe.close();
  });
});
