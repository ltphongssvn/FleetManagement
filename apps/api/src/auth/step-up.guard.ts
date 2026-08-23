// apps/api/src/auth/step-up.guard.ts
// Outside-layer adapter over evaluateStepUp(). @RequireStepUp(profile) attaches a
// validated profile KEY (StepUpProfileSchema) as route metadata; the guard reads
// it, resolves the StepUpRequirement from validated Env per profile via injected
// ConfigService at request time, then renders the RFC 9470 step-up challenge
// (HTTP 401 + WWW-Authenticate: Bearer error="insufficient_user_authentication",
// acr_values="<requiredAcr>") on any unsatisfied outcome. This is the idiomatic
// Nest pattern: the guard is the single place that maps a route to its policy and
// reads config via DI - no literal requirement baked into the decorator. RFC 9470
// defines only acr_values/max_age/scope as challenge params, so phishing-
// resistance is steered via the acr the IdP maps to that method.
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
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Env } from '../config/env.config.js';
import {
  AuthContextClaimsSchema,
  StepUpProfileSchema,
  StepUpRequirementSchema,
  type StepUpProfile,
  type StepUpRequirementInput,
} from './auth-context.schema.js';
import { evaluateStepUp } from './step-up-policy.js';

export const STEP_UP_KEY = 'fleet:step-up-profile';

export const RequireStepUp = (profile: StepUpProfile): MethodDecorator & ClassDecorator =>
  SetMetadata(STEP_UP_KEY, StepUpProfileSchema.parse(profile));

function challenge(description: string, requiredAcr: string): string {
  return (
    'Bearer error="insufficient_user_authentication", ' +
    'error_description="' +
    description +
    '", ' +
    'acr_values="' +
    requiredAcr +
    '"'
  );
}

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private resolve(profile: StepUpProfile): StepUpRequirementInput {
    // Per-profile -> validated Env. Record keyed by the profile enum keeps this
    // exhaustive: adding a profile to StepUpProfileSchema forces an entry here.
    const byProfile: Record<StepUpProfile, StepUpRequirementInput> = {
      dispatch: {
        acrLadder: this.config.getOrThrow('STEP_UP_ACR_LADDER', { infer: true }),
        requiredAcr: this.config.getOrThrow('STEP_UP_DISPATCH_REQUIRED_ACR', { infer: true }),
        requirePhishingResistant: this.config.getOrThrow(
          'STEP_UP_DISPATCH_REQUIRE_PHISHING_RESISTANT',
          { infer: true },
        ),
        phishingResistantAmr: this.config.getOrThrow('STEP_UP_PHISHING_RESISTANT_AMR', {
          infer: true,
        }),
      },
    };
    return byProfile[profile];
  }

  canActivate(ctx: ExecutionContext): Promise<boolean> {
    const profile = this.reflector.getAllAndOverride<StepUpProfile | undefined>(STEP_UP_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (profile === undefined) {
      return Promise.resolve(true);
    }
    const requirement = StepUpRequirementSchema.parse(this.resolve(profile));

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
