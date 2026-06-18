// apps/api/test/step-up.guard.test.ts
// RED for the idiomatic Nest contract: @RequireStepUp(profile) carries only a
// lightweight profile KEY as route metadata; the guard injects ConfigService and
// resolves the StepUpRequirement from validated Env at request time, then renders
// the RFC 9470 challenge on any unsatisfied outcome. (Per 2026 Nest practice the
// guard is the single place that maps a route to its policy, reading config via
// DI - not a literal requirement baked into the decorator at import time.)
import { describe, it, expect, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ConfigService } from '@nestjs/config';
import { type ExecutionContext, HttpException } from '@nestjs/common';
import { StepUpGuard, RequireStepUp, STEP_UP_KEY } from '../src/auth/step-up.guard.js';
import type { Env } from '../src/config/env.config.js';

interface Identity {
  acr?: string | null;
  amr?: readonly string[];
}

function makeConfig(over: Record<string, unknown> = {}): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    STEP_UP_ACR_LADDER: ['aal1', 'aal2', 'aal3'],
    STEP_UP_DISPATCH_REQUIRED_ACR: 'aal2',
    STEP_UP_DISPATCH_REQUIRE_PHISHING_RESISTANT: false,
    STEP_UP_PHISHING_RESISTANT_AMR: ['hwk'],
    ...over,
  };
  return {
    getOrThrow: (key: string): unknown => values[key],
  } as unknown as ConfigService<Env, true>;
}

function makeCtx(
  identity: Identity | undefined,
  profile: string | undefined,
): { ctx: ExecutionContext; setHeader: ReturnType<typeof vi.fn> } {
  const setHeader = vi.fn();
  const req = { identity } as Record<string, unknown>;
  const res = { setHeader } as Record<string, unknown>;
  const handler = (): void => undefined;
  if (profile !== undefined) Reflect.defineMetadata(STEP_UP_KEY, profile, handler);
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => handler,
    getClass: () => Object,
  } as unknown as ExecutionContext;
  return { ctx, setHeader };
}

const guard = (config: ConfigService<Env, true> = makeConfig()): StepUpGuard =>
  new StepUpGuard(new Reflector(), config);

describe('@fleet/api - StepUpGuard', () => {
  it('is a no-op (allows) when no @RequireStepUp metadata is present', async () => {
    const { ctx } = makeCtx({ acr: 'aal1' }, undefined);
    await expect(guard().canActivate(ctx)).resolves.toBe(true);
  });

  it('exposes RequireStepUp as a decorator factory', () => {
    expect(typeof RequireStepUp).toBe('function');
    expect(typeof RequireStepUp('dispatch')).toBe('function');
  });

  it('allows when the presented acr satisfies the profile requirement', async () => {
    const { ctx } = makeCtx({ acr: 'aal2', amr: ['pwd', 'otp'] }, 'dispatch');
    await expect(guard().canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects insufficient assurance with the RFC 9470 challenge header', async () => {
    const { ctx, setHeader } = makeCtx({ acr: 'aal1' }, 'dispatch');
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
    const { ctx } = makeCtx({ acr: 'aal1' }, 'dispatch');
    await expect(guard().canActivate(ctx)).rejects.toSatisfy(
      (e: unknown) => e instanceof HttpException && e.getStatus() === 401,
    );
  });

  it('rejects a phishing-resistance failure (per config), steering re-auth via acr_values', async () => {
    const cfg = makeConfig({ STEP_UP_DISPATCH_REQUIRE_PHISHING_RESISTANT: true });
    const { ctx, setHeader } = makeCtx({ acr: 'aal2', amr: ['pwd', 'otp'] }, 'dispatch');
    await expect(guard(cfg).canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
    expect(setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringContaining('acr_values="aal2"'),
    );
  });

  it('rejects when identity is missing (guard-ordering safety)', async () => {
    const { ctx } = makeCtx(undefined, 'dispatch');
    await expect(guard().canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });
});
