// apps/api/src/device/attestation.repository.ts
// Persists last accepted attestation on device_registry. Idempotent UPDATE keyed
// by deviceId; each successful attestation refreshes attestation_verified_at,
// stores the attested key material (public key SPKI, security level, environment,
// iOS keyId) and flips binding_status to pending for the TOFU admin-activation
// lifecycle. Security level / environment values derive from the sync-protocol
// SSOT enums (AttestationSecurityLevel / AttestationEnvironment).
//
// platform now derives from the SAME SSOT as its sibling fields. It was written
// out by hand as a literal union while this class implements the very interface
// that types the parameter as AttestationPlatform -- so one method signature was
// declared twice, once derived and once hand-written, and TypeScript accepted
// both only because the values coincide today. Adding a platform to
// PlatformSchema would widen the port while this implementation silently did
// not follow.
import { eq } from 'drizzle-orm';
import type { FleetDb } from '../database/database.module.js';
import { deviceRegistry } from '../database/schema/device.js';
import type { AttestationRepository } from './attestation.controller.js';
import type { AttestationPlatform } from './platform.js';
export class AttestationRepositoryImpl implements AttestationRepository {
  constructor(private readonly db: FleetDb) {}
  async markAttestationVerified(input: {
    deviceId: string;
    platform: AttestationPlatform;
    tokenHashHex: string;
    publicKeySpkiBase64: string;
    securityLevel: string | null;
    environment: string;
    keyId: string | null;
  }): Promise<void> {
    await this.db.update(deviceRegistry)
      .set({
        attestationPlatform: input.platform,
        attestationTokenHash: input.tokenHashHex,
        attestationVerifiedAt: new Date(),
        attestationPublicKeySpki: input.publicKeySpkiBase64,
        attestationSecurityLevel: input.securityLevel,
        attestationEnvironment: input.environment,
        attestationKeyId: input.keyId,
        bindingStatus: 'pending',
      })
      .where(eq(deviceRegistry.deviceId, input.deviceId));
  }
}
