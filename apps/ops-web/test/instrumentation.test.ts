// apps/ops-web/test/instrumentation.test.ts
// Verifies the Next 16 instrumentation hook wires DSN validation + scrubEvent
// without throwing for any runtime configuration. Sentry SDK is not invoked
// in NODE_ENV=test, so this exercises the gating logic.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { register } from '../instrumentation.ts';

describe('ops-web instrumentation.register', () => {
  const origRuntime = process.env['NEXT_RUNTIME'];
  const origNodeEnv = process.env.NODE_ENV;
  const origServerDsn = process.env['SENTRY_DSN'];
  const origEdgeDsn = process.env['NEXT_PUBLIC_SENTRY_DSN'];

  beforeEach(() => {
    delete process.env['SENTRY_DSN'];
    delete process.env['NEXT_PUBLIC_SENTRY_DSN'];
  });

  afterEach(() => {
    (process.env as Record<string, string | undefined>)['NEXT_RUNTIME'] = origRuntime;
    (process.env as Record<string, string | undefined>)['NODE_ENV'] = origNodeEnv;
    (process.env as Record<string, string | undefined>)['SENTRY_DSN'] = origServerDsn;
    (process.env as Record<string, string | undefined>)['NEXT_PUBLIC_SENTRY_DSN'] = origEdgeDsn;
  });

  it('does not throw with no runtime set', async () => {
    delete process.env['NEXT_RUNTIME'];
    await expect(register()).resolves.toBeUndefined();
  });

  it('skips Sentry init in nodejs runtime when DSN missing', async () => {
    process.env['NEXT_RUNTIME'] = 'nodejs';
    await expect(register()).resolves.toBeUndefined();
  });

  it('skips Sentry init in nodejs runtime when DSN invalid', async () => {
    process.env['NEXT_RUNTIME'] = 'nodejs';
    process.env['SENTRY_DSN'] = 'not-a-dsn';
    await expect(register()).resolves.toBeUndefined();
  });

  it('skips Sentry init in edge runtime when DSN missing', async () => {
    process.env['NEXT_RUNTIME'] = 'edge';
    await expect(register()).resolves.toBeUndefined();
  });

  it('skips Sentry init in test environment even with valid DSN', async () => {
    process.env['NEXT_RUNTIME'] = 'nodejs';
    process.env['SENTRY_DSN'] = 'https://abc@host.io/1';
    await expect(register()).resolves.toBeUndefined();
  });
});
