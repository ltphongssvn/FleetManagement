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
import {
  AttestationService,
  type VerifyPlayIntegrityFn,
  type VerifyAppAttestFn,
} from './attestation.service.js';
import { AttestationRepositoryImpl } from './attestation.repository.js';
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

// Placeholder verifiers. Real implementations bind google-auth-library JWS
// verification (Play Integrity) + apple App Attest assertion verification.
// They MUST throw on any signature or schema failure; the service maps thrown
// errors to invalid-platform-data.
const stubVerifyPlay: VerifyPlayIntegrityFn = (): Promise<never> => Promise.reject(new Error('Play Integrity verifier not yet configured'));
const stubVerifyApple: VerifyAppAttestFn = (): Promise<never> => Promise.reject(new Error('App Attest verifier not yet configured'));

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
      useFactory: (config: ConfigService): AttestationService => {
        const androidPackages = (config.get<string>('ATTESTATION_ANDROID_PACKAGE_NAMES') ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
        const iosBundles = (config.get<string>('ATTESTATION_IOS_BUNDLE_IDS') ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
        return new AttestationService(stubVerifyPlay, stubVerifyApple, {
          allowed: { android: androidPackages, ios: iosBundles },
          maxAgeMs: 5 * 60 * 1000,
        });
      },
    },
  ],
  exports: [DeviceService, DeviceEnrollmentService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DeviceModule {}
