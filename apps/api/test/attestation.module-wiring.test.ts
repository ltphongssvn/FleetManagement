// apps/api/test/attestation.module-wiring.test.ts
// RED: DeviceModule must wire AttestationController + service + repo + nonce store
// so DI resolves at boot.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync } from 'node:crypto';
import { DeviceModule } from '../src/device/device.module.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '../src/config/env.config.js';
import { AttestationController } from '../src/device/attestation.controller.js';
import { DeviceBindingGuard } from '../src/device/device-binding.guard.js';

function makePems(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

describe('DeviceModule wires AttestationController', () => {
  const saved: Record<string, string | undefined> = {};
  const ENV: Record<string, string> = {
    DATABASE_URL: 'postgres://localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    OIDC_ISSUER: 'https://example.com',
    OIDC_AUDIENCE: 'fleet-api',
    OIDC_JWKS_URI: 'https://example.com/.well-known/jwks.json',
    ATTESTATION_ANDROID_PACKAGE_NAMES: 'com.fleet.driver',
    ATTESTATION_IOS_BUNDLE_IDS: 'com.fleet.driver',
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

  it('resolves AttestationController via Nest DI', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, ignoreEnvFile: true }),
        DatabaseModule,
        DeviceModule,
      ],
    }).compile();
    const ctrl = moduleRef.get(AttestationController);
    expect(ctrl).toBeInstanceOf(AttestationController);
    const guard = moduleRef.get(DeviceBindingGuard);
    expect(guard).toBeInstanceOf(DeviceBindingGuard);
    await moduleRef.close();
  });
});
