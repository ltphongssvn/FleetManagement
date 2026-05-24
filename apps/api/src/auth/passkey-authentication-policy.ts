// apps/api/src/auth/passkey-authentication-policy.ts
// Pure policy for verifying a passkey authentication attempt post-cryptographic-verification.
// Mirrors auth-login-policy.ts: no I/O, no crypto. Returns LoginClaims-compatible shape.
// Rejection precedence: credential-not-found > disabled > missing-operator > cloned-authenticator > ok.
// Sign-count rule (WebAuthn L3 §6.1.3 step 21): presented MUST be strictly greater than
// stored, UNLESS both are 0 (some authenticators — notably Apple Passkeys — never increment;
// WebAuthn spec permits this as long as it remains 0 forever).
import type { LoginClaims } from './auth-login-policy.js';
export interface PasskeyAuthenticationCandidate {
  readonly driverId: string;
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
  readonly operatorId: string | null;
  readonly active: boolean;
  readonly storedSignCount: number;
}
export type PasskeyAuthenticationOutcome =
  | { readonly kind: 'credential-not-found' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'missing-operator' }
  | { readonly kind: 'cloned-authenticator' }
  | { readonly kind: 'ok'; readonly claims: LoginClaims; readonly newSignCount: number };
export function decidePasskeyAuthenticationOutcome(
  candidate: PasskeyAuthenticationCandidate | null,
  presentedSignCount: number,
): PasskeyAuthenticationOutcome {
  if (candidate === null) return { kind: 'credential-not-found' };
  if (!candidate.active) return { kind: 'disabled' };
  if (candidate.operatorId === null) return { kind: 'missing-operator' };
  const nonIncrementingAuthenticator = candidate.storedSignCount === 0 && presentedSignCount === 0;
  if (!nonIncrementingAuthenticator && presentedSignCount <= candidate.storedSignCount) {
    return { kind: 'cloned-authenticator' };
  }
  return {
    kind: 'ok',
    claims: {
      sub: candidate.operatorId,
      companyId: candidate.companyId,
      businessUnitId: candidate.businessUnitId,
      depotId: candidate.depotId,
      legalEntityId: candidate.legalEntityId,
      driverId: candidate.driverId,
    },
    newSignCount: presentedSignCount,
  };
}
