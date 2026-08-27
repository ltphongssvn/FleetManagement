// apps/api/src/device/attestation.service.ts
// Orchestrates hardware device attestation (device-binding arc, Phase 5).
// Dispatches by platform to the injected pure verifiers -- Android Key
// Attestation (X.509 chain -> pinned roots -> KeyDescription) and iOS App
// Attest (CBOR -> Apple chain -> nonce/keyId/rpIdHash) -- and maps their rich
// discriminated outcomes onto AttestationResult. On ok the result carries the
// attested key material (public key SPKI, security level, environment, iOS
// keyId) so the controller can persist it and flip the binding to pending.
// This supersedes the Play-Integrity model (D1). No crypto or network here:
// verifiers + trust-anchor membership are injected, keeping the service a thin
// dispatch+map layer.
//
// The token carries the platform proof, base64-encoded: Android = the DER cert
// chain, iOS = the CBOR attestation object. The challenge (expectedNonce)
// becomes the Android attestationChallenge and, for iOS, is hashed to the
// clientDataHash the device signed over. Security level / environment values
// derive from the sync-protocol SSOT enums.
import { createHash } from 'node:crypto';
import type { AttestationSecurityLevel, AttestationEnvironment } from '@fleet/sync-protocol';
import {
  type verifyAndroidKeyAttestation,
  type AndroidKeyAttestationOutcome,
} from './android-key-attestation-verifier.js';
import { type verifyIosAppAttest, type IosAppAttestOutcome } from './ios-app-attest-verifier.js';
import type { AttestationOutcome } from './attestation-verification-policy.js';
import type { AttestationPlatform } from './platform.js';
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
  // Derives from the SSOT (platform.ts), like the securityLevel/environment
  // siblings above. Written out by hand it was a second declaration of a
  // vocabulary AttestationPlatformSchema already owns, free to drift from the
  // controller that parses this request.
  readonly platform: AttestationPlatform;
  readonly token: string;
  readonly expectedNonce: string;
  readonly keyId?: string;
}
// Success carries the attested material for persistence; rejections reuse the
// compact AttestationOutcome rejection kinds (the ok arm is replaced here).
export type AttestationResult =
  | {
      readonly kind: 'ok';
      readonly publicKeySpkiBase64: string;
      readonly securityLevel: AttestationSecurityLevel | null;
      readonly environment: AttestationEnvironment;
      readonly keyId: string | null;
    }
  | Exclude<AttestationOutcome, { kind: 'ok' }>;
function decodeBase64(value: string): Uint8Array | null {
  if (value.length === 0) return null;
  try {
    const buf = Buffer.from(value, 'base64');
    if (buf.length === 0) return null;
    return new Uint8Array(buf);
  } catch {
    /* v8 ignore next -- Buffer.from(base64) drops invalid chars, never throws */
    return null;
  }
}
function decodeAndroidChain(token: string): Uint8Array[] | null {
  const parts = token
    .split(String.fromCharCode(10))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  const out: Uint8Array[] = [];
  for (const p of parts) {
    const der = decodeBase64(p);
    /* v8 ignore next -- defensive: a non-empty part failing base64 decode is unreachable in practice */
    if (der === null) return null;
    out.push(der);
  }
  return out;
}
function mapAndroidRejection(
  kind: Exclude<AndroidKeyAttestationOutcome['kind'], 'ok'>,
): Exclude<AttestationOutcome, { kind: 'ok' }> {
  switch (kind) {
    case 'challenge-mismatch':
      return { kind: 'nonce-mismatch' };
    case 'untrusted-root':
    case 'chain-signature-invalid':
    case 'weak-security-level':
    case 'wrong-key-purpose':
      return { kind: 'device-untrusted' };
    /* v8 ignore next 2 -- remaining kinds all map to invalid-platform-data */
    default:
      return { kind: 'invalid-platform-data' };
  }
}
function mapIosRejection(
  kind: Exclude<IosAppAttestOutcome['kind'], 'ok'>,
): Exclude<AttestationOutcome, { kind: 'ok' }> {
  switch (kind) {
    case 'nonce-mismatch':
      return { kind: 'nonce-mismatch' };
    case 'rp-id-mismatch':
      return { kind: 'app-untrusted' };
    case 'untrusted-root':
    case 'chain-signature-invalid':
    case 'bad-counter':
    case 'key-id-mismatch':
      return { kind: 'device-untrusted' };
    /* v8 ignore next 2 -- remaining kinds all map to invalid-platform-data */
    default:
      return { kind: 'invalid-platform-data' };
  }
}
export class AttestationService {
  constructor(private readonly deps: AttestationServiceDeps) {}
  async verify(req: AttestationRequest): Promise<AttestationResult> {
    const now = new Date();
    if (req.platform === 'android') {
      const chain = decodeAndroidChain(req.token);
      if (chain === null) return { kind: 'invalid-platform-data' };
      const outcome = await this.deps.verifyAndroid(chain, {
        expectedChallenge: req.expectedNonce,
        now,
        isTrustedRoot: this.deps.isTrustedRoot,
      });
      if (outcome.kind !== 'ok') return mapAndroidRejection(outcome.kind);
      return {
        kind: 'ok',
        publicKeySpkiBase64: outcome.publicKeySpkiBase64,
        securityLevel: outcome.securityLevel,
        environment: 'production',
        keyId: null,
      };
    }
    if (req.keyId === undefined) return { kind: 'invalid-platform-data' };
    const attestationObject = decodeBase64(req.token);
    const keyId = decodeBase64(req.keyId);
    if (attestationObject === null || keyId === null) return { kind: 'invalid-platform-data' };
    const clientDataHash = new Uint8Array(createHash('sha256').update(req.expectedNonce).digest());
    const expectedBundleId = this.deps.iosBundles[0] ?? '';
    const outcome = await this.deps.verifyIos(attestationObject, {
      keyId,
      clientDataHash,
      expectedTeamId: this.deps.appleTeamId,
      expectedBundleId,
      now,
      isTrustedRoot: this.deps.isTrustedRoot,
    });
    if (outcome.kind !== 'ok') return mapIosRejection(outcome.kind);
    return {
      kind: 'ok',
      publicKeySpkiBase64: outcome.publicKeySpkiBase64,
      securityLevel: null,
      environment: outcome.environment,
      keyId: req.keyId,
    };
  }
}
