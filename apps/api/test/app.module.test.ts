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

  it('should be defined', async () => {
    const { AppModule } = await import('../src/app.module.js');
    expect(AppModule).toBeDefined();
  });
});
