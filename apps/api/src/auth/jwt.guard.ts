// apps/api/src/auth/jwt.guard.ts
// Thin guard: extract Bearer token, delegate to IIdentityProvider, attach to request.
// No Passport ExecutionContext bloat - guard is testable in isolation.
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { IDENTITY_PROVIDER, type IIdentityProvider, type VerifiedIdentity } from './identity-provider.interface.js';

export interface AuthenticatedRequest extends Request {
  identity: VerifiedIdentity;
}

@Injectable()
export class JwtGuard implements CanActivate {
  private readonly logger = new Logger(JwtGuard.name);

  constructor(@Inject(IDENTITY_PROVIDER) private readonly idp: IIdentityProvider) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    const token = authHeader.slice('Bearer '.length);
    try {
      const identity = await this.idp.verifyToken(token);
      (req as AuthenticatedRequest).identity = identity;
      return true;
    } catch (err) {
      this.logger.warn(`Token verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid token');
    }
  }
}
