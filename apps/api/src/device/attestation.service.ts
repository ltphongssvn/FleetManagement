// apps/api/src/device/attestation.service.ts
// Orchestrates platform-specific token verification + pure policy decision.
// Injected verifiers (Play Integrity JWS, App Attest DER) so the service is
// unit-testable without network. Both verifiers throw on bad signature /
// malformed token; the service normalizes those to invalid-platform-data.
import {
  decideAttestationOutcome,
  type AttestationCandidate,
  type AttestationOutcome,
  type AllowedAppIdentifiers,
} from './attestation-verification-policy.js';

export interface PlayIntegrityVerdict {
  readonly packageName: string;
  readonly deviceIntegrity: readonly string[];
  readonly appIntegrity: string;
  readonly nonce: string;
  readonly timestampMs: number;
}
export interface AppAttestVerdict {
  readonly bundleId: string;
  readonly nonce: string;
  readonly timestampMs: number;
}
export type VerifyPlayIntegrityFn = (token: string) => Promise<PlayIntegrityVerdict>;
export type VerifyAppAttestFn = (token: string) => Promise<AppAttestVerdict>;

export interface AttestationConfig {
  readonly allowed: AllowedAppIdentifiers;
  readonly maxAgeMs: number;
}
export interface AttestationRequest {
  readonly platform: 'android' | 'ios';
  readonly token: string;
  readonly expectedNonce: string;
}

export class AttestationService {
  constructor(
    private readonly verifyPlay: VerifyPlayIntegrityFn,
    private readonly verifyApple: VerifyAppAttestFn,
    private readonly config: AttestationConfig,
  ) {}

  async verify(req: AttestationRequest): Promise<AttestationOutcome> {
    let candidate: AttestationCandidate;
    try {
      if (req.platform === 'android') {
        const v = await this.verifyPlay(req.token);
        candidate = {
          platform: 'android',
          packageName: v.packageName,
          deviceIntegrity: v.deviceIntegrity,
          appIntegrity: v.appIntegrity,
          nonceMatches: v.nonce === req.expectedNonce,
          ageMs: Date.now() - v.timestampMs,
          bundleId: null,
        };
      } else {
        const v = await this.verifyApple(req.token);
        candidate = {
          platform: 'ios',
          packageName: null,
          deviceIntegrity: [],
          appIntegrity: null,
          nonceMatches: v.nonce === req.expectedNonce,
          ageMs: Date.now() - v.timestampMs,
          bundleId: v.bundleId,
        };
      }
    } catch {
      return { kind: 'invalid-platform-data' };
    }
    return decideAttestationOutcome(candidate, this.config.allowed, this.config.maxAgeMs);
  }
}
