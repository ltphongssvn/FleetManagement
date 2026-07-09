// apps/owner-app/test/auth-gate-policy.test.ts
// RED: pure auth-gate decision for the owner app router.
import { describe, it, expect } from 'vitest';
import { decideAuthGate } from '../src/auth/auth-gate-policy.js';

describe('decideAuthGate', () => {
  it('shows loading while auth state is resolving', () => {
    expect(decideAuthGate('loading')).toBe('show-loading');
  });
  it('redirects to login when unauthenticated', () => {
    expect(decideAuthGate('unauthenticated')).toBe('redirect-to-login');
  });
  it('renders the app when authenticated', () => {
    expect(decideAuthGate('authenticated')).toBe('render-app');
  });
});
