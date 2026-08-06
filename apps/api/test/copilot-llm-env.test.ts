// apps/api/test/copilot-llm-env.test.ts
// The api env carries the copilot LLM adapter surface (schema-first, into the
// single EnvSchema SSOT). ANTHROPIC_API_KEY optional -> unset means the palette
// LLM port stays UNBOUND and the planner falls back to clarify (fail-safe,
// mirroring KEYCLOAK_MONITOR_CLIENT_SECRET gating). COPILOT_LLM_MODEL defaults
// to claude-haiku-4-5 (2026 best-fit for strict-JSON + sub-600ms), env-
// overridable for a model A/B with zero code change. Empty string is treated as
// absent (compose ${VAR:-} interpolation).
import { describe, expect, it } from 'vitest';
import { validateEnv } from '../src/config/env.config.js';

const BASE = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  OIDC_ISSUER: 'https://issuer.example/realms/fleet',
  OIDC_AUDIENCE: 'fleet-api',
  OIDC_JWKS_URI: 'https://issuer.example/jwks',
};

describe('env: copilot LLM adapter surface', () => {
  it('defaults COPILOT_LLM_MODEL with no key set', () => {
    const c = validateEnv({ ...BASE });
    expect(c.ANTHROPIC_API_KEY).toBeUndefined();
    expect(c.COPILOT_LLM_MODEL).toBe('claude-haiku-4-5-20251001');
  });

  it('accepts an explicit key + model override (A/B path)', () => {
    const c = validateEnv({ ...BASE, ANTHROPIC_API_KEY: 'k-abc', COPILOT_LLM_MODEL: 'claude-sonnet-4-5' });
    expect(c.ANTHROPIC_API_KEY).toBe('k-abc');
    expect(c.COPILOT_LLM_MODEL).toBe('claude-sonnet-4-5');
  });

  it('treats empty ANTHROPIC_API_KEY as absent (compose blank-string interpolation)', () => {
    const c = validateEnv({ ...BASE, ANTHROPIC_API_KEY: '' });
    expect(c.ANTHROPIC_API_KEY).toBeUndefined();
    expect(c.COPILOT_LLM_MODEL).toBe('claude-haiku-4-5-20251001');
  });

  // Anthropic documents that for generations BEFORE 4.6 a dateless id is a
  // convenience ALIAS resolving to whichever dated snapshot is current; only
  // 4.6+ dateless ids are themselves pinned. Haiku 4.5 is pre-4.6, so the bare
  // id floats. Anthropic gives at least 60 days notice before retirement and
  // requests past that date fail -- with an alias you cannot tell which side of
  // that line you are on until production starts failing. This asserts the
  // SHAPE, so a future edit back to a bare alias fails here rather than in prod.
  it('pins a DATED snapshot, never a floating alias', () => {
    const c = validateEnv({ ...BASE });
    expect(c.COPILOT_LLM_MODEL).toMatch(/-[0-9]{8}$/);
  });
});
