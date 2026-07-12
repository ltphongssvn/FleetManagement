// apps/api/src/device/attestation.service.ts
// Orchestrates hardware device attestation (device-binding arc, Phase 5).
// Dispatches by platform to the injected pure verifiers -- Android Key
// Attestation (X.509 chain -> pinned roots -> KeyDescription) and iOS App
// Attest (CBOR -> Apple chain -> nonce/keyId/rpIdHash) -- and maps their rich
// discriminated outcomes onto the compact AttestationOutcome union the
// controller consumes. This supersedes the Play-Integrity model (D1: EAS APK
// sideload makes Play Integrity verdicts unavailable; Keystore/App Attest are
// the proofs). No crypto or network here: verifiers + trust-anchor membership
// are injected, keeping the service a thin, unit-testable dispatch+map layer.
//
// The token carries the platform proof, base64-encoded: Android = the DER cert
// chain (see the driver-app packing), iOS = the CBOR attestation object. The
// challenge (expectedNonce) becomes the Android attestationChallenge and, for
// iOS, is hashed to the clientDataHash the device signed over.
import { createHash } from 'node:crypto';
import {
  type verifyAndroidKeyAttestation,
  type AndroidKeyAttestationOutcome,
} from './android-key-attestation-verifier.js';
import {
  type verifyIosAppAttest,
  type IosAppAttestOutcome,
} from './ios-app-attest-verifier.js';
import type { AttestationOutcome } from './attestation-verification-policy.js';

// Injected verifier function types (match the pure verifiers' signatures so the
// real functions drop in directly, and vitest mocks stand in for unit tests).
export type VerifyAndroidFn = typeof verifyAndroidKeyAttestation;
export type VerifyIosFn = typeof verifyIosAppAttest;

export interface AttestationServiceDeps {
  readonly verifyAndroid: VerifyAndroidFn;
  readonly verifyIos: VerifyIosFn;
  readonly isTrustedRoot: (der: Uint8Array) => boolean;
  readonly appleTeamId: string;
  readonly androidPackages: readonly string[];
  readonly iosBundles: readonly string[];
}

export interface AttestationRequest {
  readonly platform: 'android' | 'ios';
  readonly token: string;
  readonly expectedNonce: string;
  readonly keyId?: string;
}

function decodeBase64(value: string): Uint8Array | null {
  if (value.length === 0) return null;
  try {
    const buf = Buffer.from(value, 'base64');
    if (buf.length === 0) return null;
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

// The driver-app packs the Android cert chain as base64 DER certs joined by a
// single newline (one PEM-free DER blob per line). Split + decode each.
function decodeAndroidChain(token: string): Uint8Array[] | null {
  const parts = token.split(String.fromCharCode(10)).map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  const out: Uint8Array[] = [];
  for (const p of parts) {
    const der = decodeBase64(p);
    if (der === null) return null;
    out.push(der);
  }
  return out;
}

function mapAndroid(outcome: AndroidKeyAttestationOutcome): AttestationOutcome {
  switch (outcome.kind) {
    case 'ok':
      return { kind: 'ok' };
    case 'challenge-mismatch':
      return { kind: 'nonce-mismatch' };
    case 'untrusted-root':
    case 'chain-signature-invalid':
    case 'weak-security-level':
    case 'wrong-key-purpose':
      return { kind: 'device-untrusted' };
    case 'empty-chain':
    case 'certificate-parse-failed':
    case 'certificate-expired':
    case 'key-description-missing':
      return { kind: 'invalid-platform-data' };
    /* v8 ignore next 2 -- exhaustive switch; TS proves no other kind exists */
    default:
      return { kind: 'invalid-platform-data' };
  }
}

function mapIos(outcome: IosAppAttestOutcome): AttestationOutcome {
  switch (outcome.kind) {
    case 'ok':
      return { kind: 'ok' };
    case 'nonce-mismatch':
      return { kind: 'nonce-mismatch' };
    case 'rp-id-mismatch':
      return { kind: 'app-untrusted' };
    case 'untrusted-root':
    case 'chain-signature-invalid':
    case 'bad-counter':
    case 'key-id-mismatch':
      return { kind: 'device-untrusted' };
    case 'malformed-object':
    case 'certificate-expired':
      return { kind: 'invalid-platform-data' };
    /* v8 ignore next 2 -- exhaustive switch; TS proves no other kind exists */
    default:
      return { kind: 'invalid-platform-data' };
  }
}

export class AttestationService {
  constructor(private readonly deps: AttestationServiceDeps) {}

  async verify(req: AttestationRequest): Promise<AttestationOutcome> {
    const now = new Date();
    if (req.platform === 'android') {
      const chain = decodeAndroidChain(req.token);
      if (chain === null) return { kind: 'invalid-platform-data' };
      const outcome = await this.deps.verifyAndroid(chain, {
        expectedChallenge: req.expectedNonce,
        now,
        isTrustedRoot: this.deps.isTrustedRoot,
      });
      return mapAndroid(outcome);
    }
    // iOS App Attest requires the client-supplied keyId.
    if (req.keyId === undefined) return { kind: 'invalid-platform-data' };
    const attestationObject = decodeBase64(req.token);
    const keyId = decodeBase64(req.keyId);
    if (attestationObject === null || keyId === null) return { kind: 'invalid-platform-data' };
    const clientDataHash = new Uint8Array(createHash('sha256').update(req.expectedNonce).digest());
    // App Attest binds one team+bundle per deployment; the first configured
    // bundle id is authoritative for rpIdHash. (Multiple ids are a build-profile
    // convenience; iOS attestation targets exactly one app identity.)
    const expectedBundleId = this.deps.iosBundles[0] ?? '';
    const outcome = await this.deps.verifyIos(attestationObject, {
      keyId,
      clientDataHash,
      expectedTeamId: this.deps.appleTeamId,
      expectedBundleId,
      now,
      isTrustedRoot: this.deps.isTrustedRoot,
    });
    return mapIos(outcome);
  }
}
