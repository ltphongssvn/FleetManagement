// apps/api/src/auth/step-up.guard.ts
// Outside-layer adapter over evaluateStepUp(): a route guard that reads
// @RequireStepUp(requirement) metadata, evaluates the verified identity's acr/amr
// (RFC 9068 access-token claims), and on any unsatisfied outcome emits the
// RFC 9470 step-up challenge (HTTP 401 + WWW-Authenticate: Bearer
// error="insufficient_user_authentication", acr_values="<requiredAcr>") so the
// client can renegotiate a stronger authentication event. RFC 9470 only defines
// acr_values/max_age/scope as challenge params, so phishing-resistance is steered
// via the acr the IdP maps to that method - there is no amr challenge param.
// Returns a settled Promise (no async/await: the logic is synchronous) so policy
// failures surface as rejections, matching the JwtGuard test convention. No
// try/catch: metadata is produced by our own decorator and the identity is
// attached by JwtGuard, so the only failures are the deliberate rejections below.
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import {
  AuthContextClaimsSchema,
  StepUpRequirementSchema,
  type StepUpRequirementInput,
} from './auth-context.schema.js';
import { evaluateStepUp } from './step-up-policy.js';

export const STEP_UP_KEY = 'fleet:step-up-requirement';

export const RequireStepUp = (
  requirement: StepUpRequirementInput,
): MethodDecorator & ClassDecorator => SetMetadata(STEP_UP_KEY, requirement);

function challenge(description: string, requiredAcr: string): string {
  return (
    'Bearer error="insufficient_user_authentication", ' +
    'error_description="' + description + '", ' +
    'acr_values="' + requiredAcr + '"'
  );
}

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): Promise<boolean> {
    const raw = this.reflector.getAllAndOverride<unknown>(STEP_UP_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (raw === undefined) {
      return Promise.resolve(true);
    }
    const requirement = StepUpRequirementSchema.parse(raw);

    const http = ctx.switchToHttp();
    const identity: unknown = http.getRequest<{ identity?: unknown }>().identity;
    if (!identity) {
      return Promise.reject(
        new UnauthorizedException('Authentication required before step-up evaluation'),
      );
    }
    const claims = AuthContextClaimsSchema.parse(identity);
    const decision = evaluateStepUp(claims, requirement);
    if (decision.outcome === 'satisfied') {
      return Promise.resolve(true);
    }

    const description =
      decision.outcome === 'method_not_phishing_resistant'
        ? 'A phishing-resistant authentication method is required'
        : 'A different authentication level is required';
    http
      .getResponse<Response>()
      .setHeader('WWW-Authenticate', challenge(description, requirement.requiredAcr));
    return Promise.reject(
      new HttpException(
        { error: 'insufficient_user_authentication', error_description: description },
        HttpStatus.UNAUTHORIZED,
      ),
    );
  }
}
