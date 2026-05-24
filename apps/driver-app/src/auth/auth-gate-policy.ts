// apps/driver-app/src/auth/auth-gate-policy.ts
// Pure decision function for the auth gate. UI layer maps decision → component.
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';
export type AuthGateDecision = 'show-loading' | 'redirect-to-login' | 'render-app';

export function decideAuthGate(status: AuthStatus): AuthGateDecision {
  if (status === 'loading') return 'show-loading';
  if (status === 'unauthenticated') return 'redirect-to-login';
  return 'render-app';
}
