// apps/api/src/device/attestation.repository.ts
// Persists last accepted attestation on device_registry. Idempotent UPDATE keyed
// by deviceId; each successful attestation refreshes attestation_verified_at so
// callers can enforce a freshness window before allowing sensitive operations.
import { eq } from 'drizzle-orm';
import type { FleetDb } from '../database/database.module.js';
import { deviceRegistry } from '../database/schema/device.js';
import type { AttestationRepository } from './attestation.controller.js';

export class AttestationRepositoryImpl implements AttestationRepository {
  constructor(private readonly db: FleetDb) {}

  async markAttestationVerified(input: {
    deviceId: string;
    platform: 'android' | 'ios';
    tokenHashHex: string;
  }): Promise<void> {
    await this.db.update(deviceRegistry)
      .set({
        attestationPlatform: input.platform,
        attestationTokenHash: input.tokenHashHex,
        attestationVerifiedAt: new Date(),
      })
      .where(eq(deviceRegistry.deviceId, input.deviceId));
  }
}
