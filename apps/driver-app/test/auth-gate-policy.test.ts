// apps/driver-app/test/auth-gate-policy.test.ts
import { describe, it, expect } from 'vitest';
import { decideAuthGate } from '../src/auth/auth-gate-policy.js';

describe('decideAuthGate', () => {
  it('returns show-loading when status is loading', () => {
    expect(decideAuthGate('loading')).toBe('show-loading');
  });
  it('returns redirect-to-login when unauthenticated', () => {
    expect(decideAuthGate('unauthenticated')).toBe('redirect-to-login');
  });
  it('returns render-app when authenticated', () => {
    expect(decideAuthGate('authenticated')).toBe('render-app');
  });
});
