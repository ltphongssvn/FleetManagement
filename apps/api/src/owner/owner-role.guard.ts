// apps/api/src/owner/owner-role.guard.ts
// Thin HTTP adapter over decideOwnerAccess (owner-role-policy.ts). Composed
// AFTER JwtGuard on owner-only routes: JwtGuard verifies the token and attaches
// VerifiedIdentity (incl. realm roles) to req.identity, then this guard reads
// req.identity.roles and delegates the grant/deny decision to the pure policy.
// Mirrors StepUpGuard's request-shape reading. Kept free of Reflector/config -
// there is a single owner requirement, so no per-route metadata is needed.
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { VerifiedIdentity } from '../auth/identity-provider.interface.js';
import { decideOwnerAccess } from './owner-role-policy.js';

@Injectable()
export class OwnerRoleGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ identity?: VerifiedIdentity }>();
    const identity = req.identity;
    if (!identity) {
      throw new UnauthorizedException('Authentication required before owner-role check');
    }
    const decision = decideOwnerAccess(identity.roles);
    if (decision.outcome === 'granted') {
      return true;
    }
    throw new ForbiddenException('fleet-owner role required');
  }
}
