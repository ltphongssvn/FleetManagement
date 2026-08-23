// apps/api/test/auth.module-wiring.test.ts
// Wiring guard (house pattern: attestation.module-wiring.test.ts). DI
// resolution failures otherwise surface only at server bootstrap; this spec
// pins the refresh seam into the module metadata at unit-test speed.
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { AuthModule, ACCESS_TOKEN_TTL_SECONDS } from '../src/auth/auth.module.js';
import { AuthLoginController } from '../src/auth/auth-login.controller.js';
import { AuthRefreshController } from '../src/auth/auth-refresh.controller.js';
import { RefreshTokenService } from '../src/auth/refresh-token.service.js';

interface ProviderShape {
  provide?: unknown;
}

describe('AuthModule wiring', () => {
  const controllers = Reflect.getMetadata('controllers', AuthModule) as unknown[];
  const providers = Reflect.getMetadata('providers', AuthModule) as ProviderShape[];

  it('registers AuthRefreshController alongside AuthLoginController', () => {
    expect(controllers).toContain(AuthLoginController);
    expect(controllers).toContain(AuthRefreshController);
  });

  it('provides RefreshTokenService via a module factory', () => {
    const hit = providers.some((p) => p.provide === RefreshTokenService);
    expect(hit).toBe(true);
  });

  it('pins the driver access-token TTL to 15 minutes', () => {
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(900);
  });
});
