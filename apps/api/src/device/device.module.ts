// apps/api/src/device/device.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import { DeviceService } from './device.service.js';
import { DeviceEnrollmentService } from './device-enrollment.service.js';
import { DeviceEnrollmentController } from './device-enrollment.controller.js';
import {
  AttestationController,
  ATTESTATION_NONCE_STORE,
  ATTESTATION_REPO,
  type AttestationNonceStore,
} from './attestation.controller.js';
import { AttestationService } from './attestation.service.js';
import { verifyAndroidKeyAttestation } from './android-key-attestation-verifier.js';
import { verifyIosAppAttest } from './ios-app-attest-verifier.js';
import { isTrustedAttestationRoot } from './attestation-trust-store.js';
import { AttestationRepositoryImpl } from './attestation.repository.js';
import { DeviceBindingGuard, DEVICE_BINDING_STATUS_PORT } from './device-binding.guard.js';
import { DeviceBindingStatusAdapter } from './device-binding-status.adapter.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { randomBytes } from 'node:crypto';
// In-memory nonce store, operator-scoped, 5-minute TTL. Acceptable on a single
// Railway replica; multi-replica deployments need Redis with the same contract.
class InMemoryAttestationNonceStore implements AttestationNonceStore {
  private readonly m = new Map<string, { value: string; expiresAt: number }>();
  issue(operatorId: string): Promise<string> {
    const value = randomBytes(32).toString('base64url');
    this.m.set(operatorId, { value, expiresAt: Date.now() + 5 * 60 * 1000 });
    return Promise.resolve(value);
  }
  consume(operatorId: string): Promise<string | null> {
    const entry = this.m.get(operatorId);
    this.m.delete(operatorId);
    if (entry === undefined || entry.expiresAt < Date.now()) return Promise.resolve(null);
    return Promise.resolve(entry.value);
  }
}
@Module({
  imports: [AuthModule],
  controllers: [DeviceEnrollmentController, AttestationController],
  providers: [
    DeviceService,
    DeviceEnrollmentService,
    {
      provide: ATTESTATION_NONCE_STORE,
      useFactory: (): InMemoryAttestationNonceStore => new InMemoryAttestationNonceStore(),
    },
    {
      provide: ATTESTATION_REPO,
      inject: [DRIZZLE_DB],
      useFactory: (db: FleetDb): AttestationRepositoryImpl => new AttestationRepositoryImpl(db),
    },
    {
      provide: AttestationService,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AttestationService =>
        new AttestationService({
          verifyAndroid: verifyAndroidKeyAttestation,
          verifyIos: verifyIosAppAttest,
          isTrustedRoot: (der) => isTrustedAttestationRoot(der, 'android') || isTrustedAttestationRoot(der, 'ios'),
          appleTeamId: config.get<string>('ATTESTATION_APPLE_TEAM_ID') ?? '',
          androidPackages: config.get<readonly string[]>('ATTESTATION_ANDROID_PACKAGE_NAMES') ?? [],
          iosBundles: config.get<readonly string[]>('ATTESTATION_IOS_BUNDLE_IDS') ?? [],
        }),
    },
    {
      provide: DEVICE_BINDING_STATUS_PORT,
      inject: [DRIZZLE_DB],
      useFactory: (db: FleetDb): DeviceBindingStatusAdapter => new DeviceBindingStatusAdapter(db),
    },
    DeviceBindingGuard,
  ],
  exports: [DeviceService, DeviceEnrollmentService, DeviceBindingGuard],
})

export class DeviceModule {}
