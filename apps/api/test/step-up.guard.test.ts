// apps/api/test/step-up.guard.test.ts
// RED-first spec for the outside layer over evaluateStepUp(): a NestJS guard that
// reads @RequireStepUp(requirement) route metadata, evaluates the verified
// identity's acr/amr, and on any unsatisfied outcome emits the RFC 9470 challenge
// (HTTP 401 + WWW-Authenticate: Bearer error="insufficient_user_authentication",
// acr_values="<requiredAcr>"). Per RFC 9470 only acr_values/max_age/scope are
// defined challenge params - phishing-resistance is steered via the acr_values the
// IdP maps to that method, not via a non-standard amr param.
import { describe, it, expect, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { type ExecutionContext, HttpException } from '@nestjs/common';
import { StepUpGuard, RequireStepUp, STEP_UP_KEY } from '../src/auth/step-up.guard.js';

interface Identity {
  acr?: string | null;
  amr?: readonly string[];
}

function makeCtx(
  identity: Identity | undefined,
  requirement: unknown,
): { ctx: ExecutionContext; setHeader: ReturnType<typeof vi.fn> } {
  const setHeader = vi.fn();
  const req = { identity } as Record<string, unknown>;
  const res = { setHeader } as Record<string, unknown>;
  const handler = (): void => undefined;
  if (requirement !== undefined) Reflect.defineMetadata(STEP_UP_KEY, requirement, handler);
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => handler,
    getClass: () => Object,
  } as unknown as ExecutionContext;
  return { ctx, setHeader };
}

const guard = (): StepUpGuard => new StepUpGuard(new Reflector());
const REQ = { acrLadder: ['aal1', 'aal2', 'aal3'], requiredAcr: 'aal2' };
const PR = { ...REQ, requirePhishingResistant: true, phishingResistantAmr: ['hwk'] };

describe('@fleet/api - StepUpGuard', () => {
  it('is a no-op (allows) when no @RequireStepUp metadata is present', async () => {
    const { ctx } = makeCtx({ acr: 'aal1' }, undefined);
    await expect(guard().canActivate(ctx)).resolves.toBe(true);
  });

  it('exposes RequireStepUp as a decorator factory', () => {
    expect(typeof RequireStepUp).toBe('function');
    expect(typeof RequireStepUp(REQ)).toBe('function');
  });

  it('allows when presented acr satisfies the requirement', async () => {
    const { ctx } = makeCtx({ acr: 'aal2', amr: ['pwd', 'otp'] }, REQ);
    await expect(guard().canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects insufficient assurance with the RFC 9470 challenge header', async () => {
    const { ctx, setHeader } = makeCtx({ acr: 'aal1' }, REQ);
    await expect(guard().canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
    expect(setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringContaining('error="insufficient_user_authentication"'),
    );
    expect(setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringContaining('acr_values="aal2"'),
    );
  });

  it('sets HTTP 401 on the insufficient-assurance challenge', async () => {
    const { ctx } = makeCtx({ acr: 'aal1' }, REQ);
    await expect(guard().canActivate(ctx)).rejects.toSatisfy(
      (e: unknown) => e instanceof HttpException && e.getStatus() === 401,
    );
  });

  it('rejects a phishing-resistance failure, steering re-auth to requiredAcr via acr_values', async () => {
    const { ctx, setHeader } = makeCtx({ acr: 'aal2', amr: ['pwd', 'otp'] }, PR);
    await expect(guard().canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
    expect(setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringContaining('acr_values="aal2"'),
    );
  });

  it('rejects when identity is missing (guard-ordering safety)', async () => {
    const { ctx } = makeCtx(undefined, REQ);
    await expect(guard().canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });
});
