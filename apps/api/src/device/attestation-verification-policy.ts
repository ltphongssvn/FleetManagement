// apps/api/src/device/attestation-verification-policy.ts
// Pure policy for device attestation acceptance. Inputs are normalized across
// Android (Play Integrity API) and iOS (App Attest). Decision tree only — no
// crypto, no network. Verification of the attestation token itself (signature,
// JWS validation, certificate chain) happens upstream in AttestationService.
//
// Rejection precedence (most-specific first):
//   invalid-platform-data > nonce-mismatch > stale > app-untrusted > device-untrusted > ok
//
// Nonce and freshness are checked before integrity verdicts because a replay
// or stale attestation is a hard rejection regardless of device state.
export interface AttestationCandidate {
  readonly platform: 'android' | 'ios';
  readonly packageName: string | null;
  readonly deviceIntegrity: readonly string[];
  readonly appIntegrity: string | null;
  readonly nonceMatches: boolean;
  readonly ageMs: number;
  readonly bundleId: string | null;
}
export interface AllowedAppIdentifiers {
  readonly android: readonly string[];
  readonly ios: readonly string[];
}
export type AttestationOutcome =
  | { readonly kind: 'invalid-platform-data' }
  | { readonly kind: 'nonce-mismatch' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'app-untrusted' }
  | { readonly kind: 'device-untrusted' }
  | { readonly kind: 'ok' };
export function decideAttestationOutcome(
  candidate: AttestationCandidate,
  allowed: AllowedAppIdentifiers,
  maxAgeMs: number,
): AttestationOutcome {
  if (candidate.platform === 'android' && candidate.packageName === null) return { kind: 'invalid-platform-data' };
  if (candidate.platform === 'ios' && candidate.bundleId === null) return { kind: 'invalid-platform-data' };
  if (!candidate.nonceMatches) return { kind: 'nonce-mismatch' };
  if (candidate.ageMs > maxAgeMs) return { kind: 'stale' };
  if (candidate.platform === 'android') {
    if (candidate.packageName === null || !allowed.android.includes(candidate.packageName)) return { kind: 'app-untrusted' };
    if (candidate.appIntegrity !== 'PLAY_RECOGNIZED') return { kind: 'app-untrusted' };
    if (!candidate.deviceIntegrity.includes('MEETS_DEVICE_INTEGRITY')) return { kind: 'device-untrusted' };
  } else {
    if (candidate.bundleId === null || !allowed.ios.includes(candidate.bundleId)) return { kind: 'app-untrusted' };
  }
  return { kind: 'ok' };
}
