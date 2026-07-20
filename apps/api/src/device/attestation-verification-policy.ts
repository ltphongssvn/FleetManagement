// apps/api/src/device/attestation-verification-policy.ts
// Attestation outcome union (device-binding arc). The compact set of results
// the AttestationController branches on. AttestationService derives these by
// mapping the hardware verifiers rich discriminated outcomes (Android Key
// Attestation / iOS App Attest) onto this vocabulary. Internal, single-use,
// not serialized across any wire boundary -> plain TS union (not a Zod
// contract) is correct here.
//
// (History: this file previously held a Play-Integrity decision tree. That
// model was removed when the hardware verifiers subsumed it -- D1: EAS APK
// sideload makes Play Integrity verdicts unavailable, so cryptographic chain
// verification in the verifiers replaces verdict-field policy.)
export type AttestationOutcome =
  | { readonly kind: 'invalid-platform-data' }
  | { readonly kind: 'nonce-mismatch' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'app-untrusted' }
  | { readonly kind: 'device-untrusted' }
  | { readonly kind: 'ok' };
