// apps/api/test/auth-refresh.controller.test.ts
// RED spec (driver-app-security arc, Phase 3.4a): POST /auth/refresh and
// POST /auth/logout HTTP seam. Outcome mapping is security-critical:
// reused / not-found / expired are indistinguishable 401s to the caller
// (no oracle for attackers probing stolen tokens); driver-disabled is 403.
// The ok body must round-trip the sync-protocol RefreshResponseSchema SSOT.
import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { RefreshResponseSchema } from '@fleet/sync-protocol';
import { AuthRefreshController } from '../src/auth/auth-refresh.controller.js';
import type { RefreshTokenService, RotateOutcome } from '../src/auth/refresh-token.service.js';

function makeController(rotateOutcome: RotateOutcome): {
  controller: AuthRefreshController;
  rotate: ReturnType<typeof vi.fn>;
  revokeForLogout: ReturnType<typeof vi.fn>;
} {
  const rotate = vi.fn().mockResolvedValue(rotateOutcome);
  const revokeForLogout = vi.fn().mockResolvedValue(undefined);
  const svc = { rotate, revokeForLogout } as unknown as RefreshTokenService;
  return { controller: new AuthRefreshController(svc), rotate, revokeForLogout };
}

const OK: RotateOutcome = {
  kind: 'ok',
  accessToken: 'new.access.jwt',
  refreshToken: 'f'.repeat(64),
  expiresIn: 900,
};

describe('AuthRefreshController POST /auth/refresh', () => {
  it('returns the rotated pair and the body parses against the SSOT schema', async () => {
    const { controller, rotate } = makeController(OK);
    const body = await controller.refresh({ refreshToken: 'e'.repeat(64) });
    expect(rotate).toHaveBeenCalledWith('e'.repeat(64), expect.any(Number));
    const parsed = RefreshResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body.accessToken).toBe('new.access.jwt');
    expect(body.expiresIn).toBe(900);
  });

  it('maps not-found to 401 unauthorized', async () => {
    const { controller } = makeController({ kind: 'not-found' });
    await expect(controller.refresh({ refreshToken: 'a'.repeat(64) })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('maps reused to the same 401 (no reuse oracle for attackers)', async () => {
    const { controller } = makeController({ kind: 'reused' });
    await expect(controller.refresh({ refreshToken: 'b'.repeat(64) })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('maps expired to the same 401', async () => {
    const { controller } = makeController({ kind: 'expired' });
    await expect(controller.refresh({ refreshToken: 'c'.repeat(64) })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('maps driver-disabled to 403 forbidden', async () => {
    const { controller } = makeController({ kind: 'driver-disabled' });
    await expect(controller.refresh({ refreshToken: 'd'.repeat(64) })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an empty refreshToken via zod before touching the service', async () => {
    const { controller, rotate } = makeController(OK);
    await expect(controller.refresh({ refreshToken: '' } as never)).rejects.toThrow();
    expect(rotate).not.toHaveBeenCalled();
  });
});

describe('AuthRefreshController POST /auth/logout', () => {
  it('revokes the presented token and confirms', async () => {
    const { controller, revokeForLogout } = makeController(OK);
    const body = await controller.logout({ refreshToken: 'g'.repeat(64) });
    expect(revokeForLogout).toHaveBeenCalledWith('g'.repeat(64), expect.any(Number));
    expect(body).toEqual({ revoked: true });
  });

  it('rejects a missing refreshToken via zod before touching the service', async () => {
    const { controller, revokeForLogout } = makeController(OK);
    await expect(controller.logout({} as never)).rejects.toThrow();
    expect(revokeForLogout).not.toHaveBeenCalled();
  });
});
