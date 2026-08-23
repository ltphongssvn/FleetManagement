// apps/api/src/auth/refresh-rotation-policy.ts
// Pure rotation decision for driver refresh tokens (RFC 9700).
// Mirrors auth-login-policy: no IO, a candidate row + clock in, an outcome out.
// Security-critical ordering: revoked (reuse of an already-rotated token, the
// family-compromise signal) is checked BEFORE expiry, so a stolen token that
// later expired still triggers whole-family revocation. Then expiry (boundary
// inclusive: expiresAt <= now is expired), then driver-active gating.
import type { LoginClaims } from './auth-login-policy.js';

export interface RefreshCandidate {
  readonly driverId: string;
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
  readonly operatorId: string;
  readonly familyId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly driverActive: boolean;
}

export type RotationOutcome =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'reused'; readonly familyId: string }
  | { readonly kind: 'expired' }
  | { readonly kind: 'driver-disabled' }
  | { readonly kind: 'ok'; readonly familyId: string; readonly claims: LoginClaims };

export function decideRotationOutcome(
  candidate: RefreshCandidate | null,
  nowMs: number,
): RotationOutcome {
  if (candidate === null) return { kind: 'not-found' };
  if (candidate.revokedAt !== null) return { kind: 'reused', familyId: candidate.familyId };
  if (candidate.expiresAt.getTime() <= nowMs) return { kind: 'expired' };
  if (!candidate.driverActive) return { kind: 'driver-disabled' };
  return {
    kind: 'ok',
    familyId: candidate.familyId,
    claims: {
      sub: candidate.operatorId,
      companyId: candidate.companyId,
      businessUnitId: candidate.businessUnitId,
      depotId: candidate.depotId,
      legalEntityId: candidate.legalEntityId,
      driverId: candidate.driverId,
    },
  };
}
