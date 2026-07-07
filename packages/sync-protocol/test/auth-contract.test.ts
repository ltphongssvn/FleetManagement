// packages/sync-protocol/test/auth-contract.test.ts
// RED spec (driver-app-security arc, Phase 2): driver auth wire contract SSOT.
// Pins the RFC 9700 rotating-refresh pair shape shared by apps/api (producer)
// and apps/driver-app (consumer). Strip mode (z.object) is pinned: consumers
// read only known fields, so unknown members must NOT survive parsing.
import { describe, expect, it } from 'vitest';
import {
  DriverLoginRequestSchema,
  DriverLoginResponseSchema,
  RefreshRequestSchema,
  RefreshResponseSchema,
  parseDriverLoginResponse,
  parseRefreshResponse,
  type DriverLoginResponse,
  type RefreshResponse,
} from '../src/auth-contract.js';

const VALID_LOGIN_RESPONSE = {
  accessToken: 'header.payload.sig',
  refreshToken: 'a'.repeat(64),
  expiresIn: 900,
  driver: {
    driverId: '3b241101-e2bb-4255-8caf-4136c566a962',
    operatorId: '9f8b8d64-0d2a-4a6b-9c37-5a2b6f1d3e4c',
  },
} as const;

describe('DriverLoginRequestSchema', () => {
  it('accepts a valid phone + password request', () => {
    const parsed = DriverLoginRequestSchema.safeParse({ phone: '0901234567', password: 'secret' });
    expect(parsed.success).toBe(true);
  });
  it('rejects an empty phone', () => {
    const parsed = DriverLoginRequestSchema.safeParse({ phone: '', password: 'secret' });
    expect(parsed.success).toBe(false);
  });
  it('rejects a missing password', () => {
    const parsed = DriverLoginRequestSchema.safeParse({ phone: '0901234567' });
    expect(parsed.success).toBe(false);
  });
});

describe('DriverLoginResponseSchema', () => {
  it('accepts the rotated-pair login response', () => {
    const parsed = DriverLoginResponseSchema.safeParse(VALID_LOGIN_RESPONSE);
    expect(parsed.success).toBe(true);
  });
  it('accepts an optional driver fullName', () => {
    const withName = {
      ...VALID_LOGIN_RESPONSE,
      driver: { ...VALID_LOGIN_RESPONSE.driver, fullName: 'TAI XE THU NGHIEM 1' },
    };
    expect(DriverLoginResponseSchema.safeParse(withName).success).toBe(true);
  });
  it('rejects a response missing refreshToken (the pre-arc legacy shape)', () => {
    const { refreshToken, ...legacy } = VALID_LOGIN_RESPONSE;
    void refreshToken;
    expect(DriverLoginResponseSchema.safeParse(legacy).success).toBe(false);
  });
  it('rejects a non-positive expiresIn', () => {
    const bad = { ...VALID_LOGIN_RESPONSE, expiresIn: 0 };
    expect(DriverLoginResponseSchema.safeParse(bad).success).toBe(false);
  });
  it('strips unknown members (strip mode pinned)', () => {
    const noisy = { ...VALID_LOGIN_RESPONSE, extra: 'x' };
    const parsed = DriverLoginResponseSchema.parse(noisy);
    expect(Object.keys(parsed)).not.toContain('extra');
  });
});

describe('parseDriverLoginResponse', () => {
  it('returns the typed value for a valid payload', () => {
    const value: DriverLoginResponse | null = parseDriverLoginResponse(VALID_LOGIN_RESPONSE);
    expect(value).not.toBeNull();
    expect(value?.expiresIn).toBe(900);
  });
  it('returns null on junk and never throws', () => {
    expect(parseDriverLoginResponse('garbage')).toBeNull();
    expect(parseDriverLoginResponse(null)).toBeNull();
    expect(parseDriverLoginResponse({ accessToken: 42 })).toBeNull();
  });
});

describe('RefreshRequestSchema', () => {
  it('accepts a refresh token', () => {
    expect(RefreshRequestSchema.safeParse({ refreshToken: 'r'.repeat(32) }).success).toBe(true);
  });
  it('rejects an empty refresh token', () => {
    expect(RefreshRequestSchema.safeParse({ refreshToken: '' }).success).toBe(false);
  });
});

describe('RefreshResponseSchema + parseRefreshResponse', () => {
  it('accepts the rotated pair', () => {
    const rotated = { accessToken: 'h.p.s', refreshToken: 'b'.repeat(64), expiresIn: 900 };
    const value: RefreshResponse | null = parseRefreshResponse(rotated);
    expect(value).not.toBeNull();
    expect(value?.refreshToken).toBe('b'.repeat(64));
  });
  it('returns null on the reuse-detection 401 problem body (never throws)', () => {
    expect(parseRefreshResponse({ type: 'about:blank', status: 401 })).toBeNull();
  });
  it('rejects a fractional expiresIn', () => {
    const bad = { accessToken: 'h.p.s', refreshToken: 'c'.repeat(64), expiresIn: 1.5 };
    expect(RefreshResponseSchema.safeParse(bad).success).toBe(false);
  });
});
