// apps/api/test/auth-login.controller.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AuthLoginController } from '../src/auth/auth-login.controller.js';
import type { AuthLoginService } from '../src/auth/auth-login.service.js';

describe('AuthLoginController', () => {
  it('POST /auth/login returns accessToken', async () => {
    const loginFn = vi.fn().mockResolvedValue({ accessToken: 'jwt', driver: { driverId: 'd1', operatorId: 'op1' } });
    const c = new AuthLoginController({ login: loginFn } as unknown as AuthLoginService);
    const r = await c.login({ phone: '0900000001', password: 'pw' });  // pragma: allowlist secret
    expect(r.accessToken).toBe('jwt');
    expect(loginFn).toHaveBeenCalledWith('0900000001', 'pw');
  });

  it('rejects invalid phone format via zod', async () => {
    const c = new AuthLoginController({ login: vi.fn() } as unknown as AuthLoginService);
    await expect(c.login({ phone: '', password: 'pw' } as never)).rejects.toThrow();  // pragma: allowlist secret
  });
});
