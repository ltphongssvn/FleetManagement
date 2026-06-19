// apps/ops-web/test/login-error.test.ts
// RED: loginErrorMessage turns a /login?error= code into a friendly banner string.
// Known callback codes get specific copy; absent error yields undefined (no
// banner); an unknown/free-form provider code falls back to a generic message.
import { describe, it, expect } from 'vitest';
import { LoginErrorCodeSchema } from '@/features/auth/login-error.schema';
import { loginErrorMessage } from '@/features/auth/login-error';

describe('@fleet/ops-web - loginErrorMessage', () => {
  it('returns undefined when there is no error code', () => {
    expect(loginErrorMessage(undefined)).toBeUndefined();
    expect(loginErrorMessage(null)).toBeUndefined();
    expect(loginErrorMessage('')).toBeUndefined();
  });

  it('maps every known callback error code to a non-empty message', () => {
    for (const code of LoginErrorCodeSchema.options) {
      const msg = loginErrorMessage(code);
      expect(typeof msg).toBe('string');
      expect((msg ?? '').length).toBeGreaterThan(0);
    }
  });

  it('maps invalid_state to a session-could-not-be-verified style message', () => {
    expect(loginErrorMessage('invalid_state')).toMatch(/verif|expired|try again/i);
  });

  it('falls back to a generic message for an unknown provider error code', () => {
    const msg = loginErrorMessage('access_denied');
    expect(typeof msg).toBe('string');
    expect((msg ?? '').length).toBeGreaterThan(0);
  });
});
