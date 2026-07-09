// apps/api/src/auth/auth-refresh.controller.ts
// POST /auth/refresh + POST /auth/logout for the driver public client.
// Bodies parse against the @fleet/sync-protocol SSOT (Axis 1: validate at
// the trust boundary; Axis 2: no hand-written duplicate shapes). Outcome
// mapping is deliberately oracle-free: not-found, reused and expired all
// surface as the same 401 so a probing attacker cannot distinguish a
// never-issued token from a stolen-and-rotated one; driver-disabled is 403.
import { Body, Controller, ForbiddenException, Post, UnauthorizedException } from '@nestjs/common';
import { RefreshRequestSchema, type RefreshResponse } from '@fleet/sync-protocol';
import { RefreshTokenService } from './refresh-token.service.js';

@Controller('auth')
export class AuthRefreshController {
  constructor(private readonly refreshTokens: RefreshTokenService) {}

  @Post('refresh')
  async refresh(@Body() body: unknown): Promise<RefreshResponse> {
    const parsed = RefreshRequestSchema.parse(body);
    const outcome = await this.refreshTokens.rotate(parsed.refreshToken, Date.now());
    switch (outcome.kind) {
      case 'ok':
        return {
          accessToken: outcome.accessToken,
          refreshToken: outcome.refreshToken,
          expiresIn: outcome.expiresIn,
        };
      case 'driver-disabled':
        throw new ForbiddenException('disabled');
      case 'not-found':
      case 'reused':
      case 'expired':
        throw new UnauthorizedException('unauthorized');
    }
  }

  @Post('logout')
  async logout(@Body() body: unknown): Promise<{ revoked: true }> {
    const parsed = RefreshRequestSchema.parse(body);
    await this.refreshTokens.revokeForLogout(parsed.refreshToken, Date.now());
    return { revoked: true };
  }
}
