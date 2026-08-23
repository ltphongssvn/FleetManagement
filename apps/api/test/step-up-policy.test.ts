// apps/api/test/step-up-policy.test.ts
// RED-first spec for the fleet API step-up / MFA-assurance enforcement policy.
// Drives evaluateStepUp(): a PURE decision over verified Keycloak JWT claims
// (acr/amr) plus a config-sourced requirement, returning a discriminated union
// that maps 1:1 onto the RFC 9470 insufficient_user_authentication challenge.
//
// The contract it is tested against (auth-context.schema.ts) is authored first.
import { describe, it, expect } from 'vitest';
import {
  AuthContextClaimsSchema,
  StepUpRequirementSchema,
} from '../src/auth/auth-context.schema.js';
import type { AuthContextClaims, StepUpRequirement } from '../src/auth/auth-context.schema.js';
import { evaluateStepUp } from '../src/auth/step-up-policy.js';

const LADDER = ['aal1', 'aal2', 'aal3'] as const;

const requirement = (overrides: Record<string, unknown> = {}): StepUpRequirement =>
  StepUpRequirementSchema.parse({ acrLadder: [...LADDER], requiredAcr: 'aal2', ...overrides });

const claims = (acr: string | null, amr?: readonly string[]): AuthContextClaims =>
  AuthContextClaimsSchema.parse({ acr, amr });

describe('auth-context contract (schema-first)', () => {
  it('rejects a requiredAcr that is not a member of the ladder', () => {
    expect(() =>
      StepUpRequirementSchema.parse({ acrLadder: [...LADDER], requiredAcr: 'platinum' }),
    ).toThrow(/requiredAcr/);
  });

  it('requires a non-empty phishingResistantAmr when phishing resistance is demanded', () => {
    expect(() =>
      StepUpRequirementSchema.parse({
        acrLadder: [...LADDER],
        requiredAcr: 'aal2',
        requirePhishingResistant: true,
      }),
    ).toThrow(/phishingResistantAmr/);
  });

  it('accepts a token with neither acr nor amr (Keycloak SSO / level 0)', () => {
    expect(() => AuthContextClaimsSchema.parse({})).not.toThrow();
  });
});

describe('evaluateStepUp - assurance gate on acr', () => {
  it('satisfied when presented acr equals required', () => {
    expect(evaluateStepUp(claims('aal2'), requirement())).toEqual({ outcome: 'satisfied' });
  });

  it('satisfied when presented acr is stronger than required', () => {
    expect(evaluateStepUp(claims('aal3'), requirement())).toEqual({ outcome: 'satisfied' });
  });

  it('insufficient when presented acr is weaker than required', () => {
    expect(evaluateStepUp(claims('aal1'), requirement())).toEqual({
      outcome: 'insufficient_assurance',
      requiredAcr: 'aal2',
      presentedAcr: 'aal1',
    });
  });

  it('insufficient when acr is absent (null)', () => {
    expect(evaluateStepUp(claims(null), requirement())).toEqual({
      outcome: 'insufficient_assurance',
      requiredAcr: 'aal2',
      presentedAcr: null,
    });
  });

  it('insufficient when acr is an unknown value not on the ladder', () => {
    expect(evaluateStepUp(claims('bronze'), requirement())).toEqual({
      outcome: 'insufficient_assurance',
      requiredAcr: 'aal2',
      presentedAcr: 'bronze',
    });
  });
});

describe('evaluateStepUp - phishing-resistant method gate on amr', () => {
  const pr = (): StepUpRequirement =>
    requirement({
      requiredAcr: 'aal2',
      requirePhishingResistant: true,
      phishingResistantAmr: ['hwk'],
    });

  it('rejects a sufficient-acr token whose amr proves no phishing-resistant method', () => {
    expect(evaluateStepUp(claims('aal2', ['pwd', 'otp']), pr())).toEqual({
      outcome: 'method_not_phishing_resistant',
      required: ['hwk'],
      presentedAmr: ['pwd', 'otp'],
    });
  });

  it('rejects when amr is absent entirely', () => {
    expect(evaluateStepUp(claims('aal2'), pr())).toEqual({
      outcome: 'method_not_phishing_resistant',
      required: ['hwk'],
      presentedAmr: [],
    });
  });

  it('satisfied when a phishing-resistant method is present alongside sufficient acr', () => {
    expect(evaluateStepUp(claims('aal3', ['pwd', 'hwk']), pr())).toEqual({ outcome: 'satisfied' });
  });

  it('checks assurance BEFORE method: weak acr is insufficient_assurance even if PR method present', () => {
    expect(evaluateStepUp(claims('aal1', ['hwk']), pr())).toEqual({
      outcome: 'insufficient_assurance',
      requiredAcr: 'aal2',
      presentedAcr: 'aal1',
    });
  });
});
