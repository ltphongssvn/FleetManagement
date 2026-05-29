// apps/api/src/auth/passkey-registration-policy.ts
// Pure policy for deciding whether a driver may register a new WebAuthn/Passkey credential.
// Mirrors the auth-login-policy.ts pattern: no I/O, no crypto — only the decision tree.
// Rejection precedence (most-specific first): not-found > disabled > missing-operator >
//   credential-collision > limit-exceeded > ok.
// Collision is checked before limit because a globally-duplicate credentialId is a hard
// spec violation (WebAuthn requires global uniqueness) regardless of per-user count.
export interface PasskeyRegistrationCandidate {
  readonly driverId: string;
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
  readonly operatorId: string | null;
  readonly active: boolean;
  readonly existingCredentialCount: number;
}
export interface PasskeyBinding {
  readonly driverId: string;
  readonly operatorId: string;
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
}
export type PasskeyRegistrationOutcome =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'missing-operator' }
  | { readonly kind: 'credential-collision' }
  | { readonly kind: 'limit-exceeded' }
  | { readonly kind: 'ok'; readonly binding: PasskeyBinding };
export function decidePasskeyRegistrationOutcome(
  candidate: PasskeyRegistrationCandidate | null,
  credentialIdAlreadyExists: boolean,
  maxCredentialsPerDriver: number,
): PasskeyRegistrationOutcome {
  if (candidate === null) return { kind: 'not-found' };
  if (!candidate.active) return { kind: 'disabled' };
  if (candidate.operatorId === null) return { kind: 'missing-operator' };
  if (credentialIdAlreadyExists) return { kind: 'credential-collision' };
  if (candidate.existingCredentialCount >= maxCredentialsPerDriver) return { kind: 'limit-exceeded' };
  return {
    kind: 'ok',
    binding: {
      driverId: candidate.driverId,
      operatorId: candidate.operatorId,
      companyId: candidate.companyId,
      businessUnitId: candidate.businessUnitId,
      depotId: candidate.depotId,
      legalEntityId: candidate.legalEntityId,
    },
  };
}
