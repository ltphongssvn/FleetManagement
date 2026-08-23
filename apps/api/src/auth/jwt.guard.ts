// apps/api/src/auth/jwt.guard.ts
// Verifies Bearer token + attaches both VerifiedIdentity and derived
// OperatorContext to the request so downstream decorators can read either.
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  IDENTITY_PROVIDER,
  type IIdentityProvider,
  type VerifiedIdentity,
} from './identity-provider.interface.js';
import type { OperatorContext } from './operator-context.js';
import { OperatorContextFactory } from './operator-context.factory.js';

export interface AuthenticatedRequest extends Request {
  identity: VerifiedIdentity;
  fleetOperator: OperatorContext;
}

@Injectable()
export class JwtGuard implements CanActivate {
  private readonly logger = new Logger(JwtGuard.name);

  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly idp: IIdentityProvider,
    private readonly operatorFactory: OperatorContextFactory,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    const token = authHeader.slice('Bearer '.length);
    try {
      const identity = await this.idp.verifyToken(token);
      const fleetOperator = this.operatorFactory.fromIdentity(identity);
      (req as AuthenticatedRequest).identity = identity;
      (req as AuthenticatedRequest).fleetOperator = fleetOperator;
      return true;
    } catch (err) {
      this.logger.warn(`Token verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid token');
    }
  }
}
