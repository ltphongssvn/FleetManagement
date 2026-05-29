// apps/api/test/app.module.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
describe('@fleet/api - AppModule', () => {
  beforeAll(() => {
    process.env['DATABASE_URL'] = 'postgres://localhost:5432/fleet_test';
    process.env['OIDC_ISSUER'] = 'https://idp.example.com/';
    process.env['OIDC_AUDIENCE'] = 'fleet-api';
    process.env['OIDC_JWKS_URI'] = 'https://idp.example.com/.well-known/jwks.json';
    process.env['AWS_REGION'] = 'us-west-2';
    process.env['S3_ARTIFACTS_BUCKET'] = 'fleet-test';
  });
  // No per-test timeout override: importing the full Nest AppModule graph
  // takes ~15s isolated but can exceed 30s under the 8-package parallel
  // turbo run (CPU contention from pglite-smoke / expo-push-provider).
  // A hardcoded 30_000 here shadowed vitest.config.ts testTimeout:60_000
  // and caused non-deterministic failures. Inherit the 60s config budget.
  it('should be defined', async () => {
    const { AppModule } = await import('../src/app.module.js');
    expect(AppModule).toBeDefined();
  });
});
