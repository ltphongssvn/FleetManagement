// apps/driver-app/test/login-form-policy.test.ts
// RED: pure function deciding submit outcome from form state.
import { describe, it, expect } from 'vitest';
import { decideLoginSubmit } from '../src/auth/login-form-policy.js';

describe('decideLoginSubmit', () => {
  it('returns missing-phone when phone empty', () => {
    expect(decideLoginSubmit('', 'pw')).toEqual({ kind: 'missing-phone' });
  });
  it('returns missing-password when password empty', () => {
    expect(decideLoginSubmit('0900000001', '')).toEqual({ kind: 'missing-password' });
  });
  it('returns missing-both when both empty', () => {
    expect(decideLoginSubmit('', '')).toEqual({ kind: 'missing-phone' });
  });
  it('returns submit with trimmed phone when both present', () => {
    expect(decideLoginSubmit('  0900000001  ', 'pw')).toEqual({
      kind: 'submit',
      phone: '0900000001',
      password: 'pw',  // pragma: allowlist secret
    });
  });
});
