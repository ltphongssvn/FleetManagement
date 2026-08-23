// apps/api/src/auth/passkey.controller.ts
// HTTP layer for WebAuthn/Passkey registration + authentication.
// Registration endpoints require JWT (CurrentOperator); authentication endpoints are
// anonymous since the client doesn't have a session yet (usernameless flow).
// finishAuth returns the same LoginResult shape as AuthLoginController.login so clients
// can reuse code paths and store the access token identically.
import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentOperator } from './current-operator.decorator.js';
import { JwtGuard } from './jwt.guard.js';
import { PasskeyRegistrationService } from './passkey-registration.service.js';
import { PasskeyAuthenticationService } from './passkey-authentication.service.js';
import type { SignJwtFn, LoginResult } from './auth-login.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import type { OperatorContext } from '@fleet/domain';

export const SIGN_JWT_TOKEN = Symbol.for('SignJwtFn');

const FinishAuthSchema = z
  .object({
    id: z.string().min(1),
    challenge: z.string().min(1),
  })
  .loose();
type FinishAuthBody = z.infer<typeof FinishAuthSchema>;

@Controller('auth/passkey')
export class PasskeyController {
  constructor(
    private readonly regSvc: PasskeyRegistrationService,
    private readonly authSvc: PasskeyAuthenticationService,
    @Inject(SIGN_JWT_TOKEN) private readonly signJwt: SignJwtFn,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  @UseGuards(JwtGuard)
  @Post('register/options')
  async beginRegister(
    @CurrentOperator() op: OperatorContext,
  ): Promise<{ challenge: string; rp: unknown; user: unknown; pubKeyCredParams: unknown }> {
    return this.regSvc.beginRegistration(op.operatorId);
  }

  @UseGuards(JwtGuard)
  @Post('register/verify')
  async finishRegister(
    @CurrentOperator() op: OperatorContext,
    @Body() body: unknown,
  ): Promise<{ verified: true }> {
    return this.regSvc.finishRegistration(op.operatorId, body);
  }

  @Post('authenticate/options')
  async beginAuth(): Promise<{ challenge: string; rpId: string; timeout: number }> {
    return this.authSvc.beginAuthentication();
  }

  @Post('authenticate/verify')
  async finishAuth(@Body() body: FinishAuthBody): Promise<LoginResult> {
    const parsed = FinishAuthSchema.parse(body);
    const { claims } = await this.authSvc.finishAuthentication(parsed, parsed.challenge);
    const accessToken = await this.signJwt(claims);
    const issued = await this.refreshTokens.issueForLogin(claims, Date.now());
    return {
      accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: this.refreshTokens.accessTtlSeconds,
      driver: { driverId: claims.driverId, operatorId: claims.sub },
    };
  }
}
