// scripts/e2e/ops-web-runner.test.ts
// Outside-in RED: the contract for the ops-web E2E runner BEFORE it exists.
// SSOT = a Zod schema (opsWebE2EEnvSchema) that fail-fast validates the three
// E2E_* vars (closes critique #5), plus a pure readiness-target builder
// (readinessTargets) listing the URLs the runner must poll before invoking
// Playwright (closes critique #6-residue). Imported from a module that does
// not exist yet -> this suite MUST fail at import (RED for the right reason:
// module-not-found on the SUT, not an assertion typo).
//
// FIXTURE GOES THROUGH THE SCHEMA (2026-08-08). The readinessTargets case built
// a bare object literal with the three E2E_* vars. readinessTargets takes the
// PARSED type, where E2E_REPORTER is required (.default('list') makes it
// optional on input, present on output), so the literal did not satisfy it --
// one of the 58 errors the //#typecheck:scripts ratchet records. Parsing the
// literal instead of hand-adding E2E_REPORTER is the better fix: it is exactly
// what main() does, it exercises the default rather than duplicating it, and a
// future schema field cannot leave this fixture stale.
import { describe, it, expect } from 'vitest';
import {
  opsWebE2EEnvSchema,
  readinessTargets,
} from './ops-web-runner.ts';

describe('opsWebE2EEnvSchema', () => {
  it('accepts a fully-specified env and yields typed values', () => {
    const parsed = opsWebE2EEnvSchema.parse({
      E2E_BASE_URL: 'http://localhost:3001',
      E2E_API_URL: 'http://localhost:3000',
      E2E_OPS_PASSWORD: 'pw', // pragma: allowlist secret -- mock-oauth2 test value, not a real credential
    });
    expect(parsed.E2E_API_URL).toBe('http://localhost:3000');
  });

  it('rejects a non-URL base (fail-fast, not a silent ?? fallback)', () => {
    const r = opsWebE2EEnvSchema.safeParse({
      E2E_BASE_URL: 'not-a-url',
      E2E_API_URL: 'http://localhost:3000',
      E2E_OPS_PASSWORD: 'pw', // pragma: allowlist secret -- mock-oauth2 test value, not a real credential
    });
    expect(r.success).toBe(false);
  });

  it('rejects an empty ops password', () => {
    const r = opsWebE2EEnvSchema.safeParse({
      E2E_BASE_URL: 'http://localhost:3001',
      E2E_API_URL: 'http://localhost:3000',
      E2E_OPS_PASSWORD: '',
    });
    expect(r.success).toBe(false);
  });
});

describe('opsWebE2EEnvSchema E2E_REPORTER', () => {
  it('defaults E2E_REPORTER to "list" (one settled line per test) when unset', () => {
    const parsed = opsWebE2EEnvSchema.parse({
      E2E_BASE_URL: 'http://localhost:3001',
      E2E_API_URL: 'http://localhost:3000',
      E2E_OPS_PASSWORD: 'pw', // pragma: allowlist secret -- mock-oauth2 test value, not a real credential
    });
    expect(parsed.E2E_REPORTER).toBe('list');
  });

  it('accepts an explicit valid reporter', () => {
    const parsed = opsWebE2EEnvSchema.parse({
      E2E_BASE_URL: 'http://localhost:3001',
      E2E_API_URL: 'http://localhost:3000',
      E2E_OPS_PASSWORD: 'pw', // pragma: allowlist secret -- mock-oauth2 test value, not a real credential
      E2E_REPORTER: 'line',
    });
    expect(parsed.E2E_REPORTER).toBe('line');
  });

  it('rejects an unknown reporter', () => {
    const r = opsWebE2EEnvSchema.safeParse({
      E2E_BASE_URL: 'http://localhost:3001',
      E2E_API_URL: 'http://localhost:3000',
      E2E_OPS_PASSWORD: 'pw', // pragma: allowlist secret -- mock-oauth2 test value, not a real credential
      E2E_REPORTER: 'nonsense-reporter',
    });
    expect(r.success).toBe(false);
  });
});

describe('readinessTargets', () => {
  it('derives the api /health/ready probe and the ops-web base from the env', () => {
    const targets = readinessTargets(
      opsWebE2EEnvSchema.parse({
        E2E_BASE_URL: 'http://localhost:3001',
        E2E_API_URL: 'http://localhost:3000',
        E2E_OPS_PASSWORD: 'pw', // pragma: allowlist secret -- mock-oauth2 test value, not a real credential
      }),
    );
    expect(targets).toContain('http://localhost:3000/health/ready');
    expect(targets).toContain('http://localhost:3001');
  });
});
