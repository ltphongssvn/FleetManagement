// apps/api/test/transport-orders.module-wiring.stop-proof.test.ts
// RED (DI): TransportOrdersService must actually RECEIVE a StopProofUrlSigner in
// production wiring. Without this, the review row still reports proof = null at
// runtime while every unit and integration test passes (they inject a fake), so
// the user-visible defect would survive a fully green suite. This pins the seam.
//
// DispatchModule already builds the signer provider; TransportOrdersModule must
// import it, and DispatchModule must EXPORT it -- exported, never redefined,
// since duplicating the provider would give the board and the review view two
// independently-configured signers (the Axis-2 DI-duplication trap).
//
// compile() does not run onModuleInit, so no S3 or Redis connection is opened.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '../src/config/env.config.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { TransportOrdersModule } from '../src/transport-orders/transport-orders.module.js';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { STOP_PROOF_URL_SIGNER } from '../src/dispatch/stop-proof-url.port.js';

describe('TransportOrdersModule wires the stop-proof signer into the review read', () => {
  const saved: Record<string, string | undefined> = {};
  const ENV: Record<string, string> = {
    DATABASE_URL: 'postgres://localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    OIDC_ISSUER: 'https://example.com',
    OIDC_AUDIENCE: 'fleet-api',
    OIDC_JWKS_URI: 'https://example.com/.well-known/jwks.json',
    AWS_REGION: 'ap-southeast-1',
  };
  beforeAll(() => {
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

  it('resolves a StopProofUrlSigner through TransportOrdersModule DI', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, ignoreEnvFile: true }),
        DatabaseModule,
        TransportOrdersModule,
      ],
    }).compile();
    const signer: unknown = moduleRef.get(STOP_PROOF_URL_SIGNER);
    expect(signer).toBeDefined();
    const svc = moduleRef.get(TransportOrdersService);
    expect(svc).toBeInstanceOf(TransportOrdersService);
    await moduleRef.close();
  });

  it('gives TransportOrdersService a NON-undefined signer, so review proofs resolve in production', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, ignoreEnvFile: true }),
        DatabaseModule,
        TransportOrdersModule,
      ],
    }).compile();
    const svc = moduleRef.get(TransportOrdersService);
    // The signer is a private constructor param; reading it through an indexed
    // record is the narrowest way to assert the injection actually happened
    // without widening the production API surface just for a test.
    const injected = (svc as unknown as Record<string, unknown>)['proofSigner'];
    expect(injected).toBeDefined();
    expect(typeof (injected as { presignProofUrl?: unknown }).presignProofUrl).toBe('function');
    await moduleRef.close();
  });
});
