// apps/ops-web/test/oidc-token-claims.schema.test.ts
// Spec derived from the oidc-token-claims contract (single source of truth for a
// valid passwordless login token). Verifies the LoA ladder, acr normalization,
// the brokered-idp + acr-floor gate, and JWT claim decoding. The dispatcher
// passwordless guarantee (Google-brokered + MFA) is only as strong as these
// checks, so each rejection path is asserted explicitly.
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  LOA_ORDER,
  type LevelOfAssurance,
  AcrClaimSchema,
  IdpClaimSchema,
  AccessTokenClaimsSchema,
  DISPATCHER_PASSWORDLESS_POLICY,
  meetsAcrFloor,
  decodeAccessTokenClaims,
  evaluatePasswordlessLogin,
} from '../src/features/auth/oidc-token-claims.schema';

// Build a realistic 3-segment JWT. The signature is irrelevant: ops-web decodes
// (does not verify) claims at the callback; JWKS verification is the API's job.
function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = createHmac('sha256', 'test').update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

describe('@fleet/ops-web - LoA ladder', () => {
  it('orders aal1 < aal2 < aal3', () => {
    expect(LOA_ORDER.indexOf('aal1')).toBeLessThan(LOA_ORDER.indexOf('aal2'));
    expect(LOA_ORDER.indexOf('aal2')).toBeLessThan(LOA_ORDER.indexOf('aal3'));
  });
});

describe('@fleet/ops-web - AcrClaimSchema normalization', () => {
  it('normalizes numeric "2" to aal2', () => {
    expect(AcrClaimSchema.parse('2')).toBe<LevelOfAssurance>('aal2');
  });
  it('accepts symbolic "aal3" unchanged', () => {
    expect(AcrClaimSchema.parse('aal3')).toBe<LevelOfAssurance>('aal3');
  });
  it('rejects an unknown acr value', () => {
    expect(() => AcrClaimSchema.parse('banana')).toThrow();
  });
});

describe('@fleet/ops-web - IdpClaimSchema', () => {
  it('accepts google', () => {
    expect(IdpClaimSchema.parse('google')).toBe('google');
  });
  it('rejects a non-supported idp', () => {
    expect(() => IdpClaimSchema.parse('facebook')).toThrow();
  });
});

describe('@fleet/ops-web - AccessTokenClaimsSchema', () => {
  it('parses a well-formed brokered+MFA payload', () => {
    const c = AccessTokenClaimsSchema.parse({ acr: '2', idp: 'google', aud: 'fleet-pilot', exp: 9999999999 });
    expect(c.acr).toBe<LevelOfAssurance>('aal2');
    expect(c.idp).toBe('google');
    expect(c.aud).toEqual(['fleet-pilot']);
  });
  it('normalizes a string aud to an array', () => {
    const c = AccessTokenClaimsSchema.parse({ acr: 'aal2', exp: 1, aud: 'fleet-pilot' });
    expect(c.aud).toEqual(['fleet-pilot']);
  });
  it('requires acr (cannot prove step-up otherwise)', () => {
    expect(() => AccessTokenClaimsSchema.parse({ idp: 'google', exp: 1 })).toThrow();
  });
  it('requires exp (no undated token)', () => {
    expect(() => AccessTokenClaimsSchema.parse({ acr: 'aal2', idp: 'google' })).toThrow();
  });
});

describe('@fleet/ops-web - meetsAcrFloor', () => {
  it('passes equal and higher, fails lower', () => {
    expect(meetsAcrFloor('aal2', 'aal2')).toBe(true);
    expect(meetsAcrFloor('aal3', 'aal2')).toBe(true);
    expect(meetsAcrFloor('aal1', 'aal2')).toBe(false);
  });
});

describe('@fleet/ops-web - decodeAccessTokenClaims', () => {
  it('decodes claims from a JWT access token', () => {
    const token = makeJwt({ acr: 'aal3', idp: 'google', aud: 'fleet-pilot', exp: 9999999999 });
    const c = decodeAccessTokenClaims(token);
    expect(c.acr).toBe<LevelOfAssurance>('aal3');
    expect(c.idp).toBe('google');
  });
  it('throws on a non-JWT (wrong segment count)', () => {
    expect(() => decodeAccessTokenClaims('not-a-jwt')).toThrow();
  });
  it('throws on a JWT whose payload is not valid JSON', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const bad = `${header}.@@@notjson@@@.sig`;
    expect(() => decodeAccessTokenClaims(bad)).toThrow();
  });
  it('throws on a 3-segment JWT with an EMPTY payload segment', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    // "header..sig" -> exactly 3 segments but the middle (payload) is empty.
    expect(() => decodeAccessTokenClaims(`${header}..sig`)).toThrow();
  });
});

describe('@fleet/ops-web - evaluatePasswordlessLogin (the gate)', () => {
  it('accepts a Google-brokered passkey token at aal3 (the only passing level)', () => {
    const r = evaluatePasswordlessLogin(
      { acr: 'aal3', idp: 'google', exp: 9999999999 },
      DISPATCHER_PASSWORDLESS_POLICY,
    );
    expect(r.ok).toBe(true);
  });
  it('REJECTS a Google-brokered TOTP token at aal2 (below the aal3 passkey floor)', () => {
    const r = evaluatePasswordlessLogin(
      { acr: 'aal2', idp: 'google', exp: 9999999999 },
      DISPATCHER_PASSWORDLESS_POLICY,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('insufficient_acr');
  });
  it('REJECTS insufficient_acr (aal1, well below the aal3 floor)', () => {
    const r = evaluatePasswordlessLogin(
      { acr: 'aal1', idp: 'google', exp: 9999999999 },
      DISPATCHER_PASSWORDLESS_POLICY,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('insufficient_acr');
  });
  it('REJECTS idp_not_brokered (MFA met but not via Google)', () => {
    const r = evaluatePasswordlessLogin(
      { acr: 'aal3', exp: 9999999999 },
      DISPATCHER_PASSWORDLESS_POLICY,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('idp_not_brokered');
  });
});
