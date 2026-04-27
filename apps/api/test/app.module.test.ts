// apps/api/test/app.module.test.ts
import { describe, it, expect, beforeAll } from 'vitest';

describe('@fleet/api - AppModule', () => {
  beforeAll(() => {
    process.env['DATABASE_URL'] = 'postgres://localhost:5432/fleet_test';
    process.env['OIDC_ISSUER'] = 'https://idp.example.com/';
    process.env['OIDC_AUDIENCE'] = 'fleet-api';
    process.env['OIDC_JWKS_URI'] = 'https://idp.example.com/.well-known/jwks.json';
  });

  it('should be defined', async () => {
    const { AppModule } = await import('../src/app.module.js');
    expect(AppModule).toBeDefined();
  });
});
