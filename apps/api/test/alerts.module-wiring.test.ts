// apps/api/test/alerts.module-wiring.test.ts
// S3 RED (T12): AlertsModule must wire ALERTS_WORKER_FACTORY (real BullMQ
// factory bound to the OutboxModule-exported BULLMQ_CONNECTION -- exported,
// never redefined: DI-config duplication is the Axis-2 analog) + PushModule's
// PUSH_PROVIDER so AlertsConsumerService resolves at boot. onModuleInit is NOT
// triggered by createTestingModule().compile(), so no Redis connection is
// attempted here -- this pins DI wiring, not queue I/O.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '../src/config/env.config.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { AlertsModule } from '../src/alerts/alerts.module.js';
import { AlertsConsumerService, ALERTS_WORKER_FACTORY } from '../src/alerts/alerts-consumer.service.js';

describe('AlertsModule wires AlertsConsumerService', () => {
  const saved: Record<string, string | undefined> = {};
  const ENV: Record<string, string> = {
    DATABASE_URL: 'postgres://localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    OIDC_ISSUER: 'https://example.com',
    OIDC_AUDIENCE: 'fleet-api',
    OIDC_JWKS_URI: 'https://example.com/.well-known/jwks.json',
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
  it('resolves AlertsConsumerService and a callable worker factory via Nest DI', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, ignoreEnvFile: true }),
        DatabaseModule,
        AlertsModule,
      ],
    }).compile();
    const svc = moduleRef.get(AlertsConsumerService);
    expect(svc).toBeInstanceOf(AlertsConsumerService);
    const factory: unknown = moduleRef.get(ALERTS_WORKER_FACTORY);
    expect(typeof factory).toBe('function');
    await moduleRef.close();
  });
});
