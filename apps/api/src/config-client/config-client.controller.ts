// apps/api/src/config-client/config-client.controller.ts
// GET /config/client per Frozen Stack PDF "Config" section. Returns all
// tunables. Pilot scope: hardcoded defaults; surface from session enforced
// in production by /config/client OpenAPI guard.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';

export interface RetryPolicyEntry {
  readonly maxAttempts: number;
  readonly baseSeconds: number;
  readonly jitterRatio: number;
}

export interface CapabilityFlags {
  readonly enableChunkChecksums: boolean;
  readonly enableDynamicBackpressure: boolean;
  readonly enableRuntimeStrictValidator: boolean;
  readonly enableAtomicConfigLockCoordination: boolean;
  readonly enableArtifactContendedShadowCircuitBreaker: boolean;
}

export interface ClientConfig {
  readonly configVersion: number;
  readonly polygonVersion: number;
  readonly hysteresisVersion: number;
  readonly configFlagVersion: number;
  readonly shadowSessionLimit: number;
  readonly shadowIdleTimeoutMs: number;
  readonly arrivalHintDedupWindowSeconds: number;
  readonly arrivalHintExpiryHours: number;
  readonly geofenceToleranceMeters: number;
  readonly geofenceHysteresisSeconds: number;
  readonly tieBreakerBufferMeters: number;
  readonly bootstrapAbandonedAfterMinutes: number;
  readonly softGraceSeconds: number;
  readonly hardGraceSeconds: number;
  readonly advisoryLockMaxWaitMs: number;
  readonly revocationReasonSchemaVersion: number;
  readonly retryPolicy: Record<string, RetryPolicyEntry>;
  readonly capabilityFlags: CapabilityFlags;
}

const PILOT_CONFIG: ClientConfig = Object.freeze({
  configVersion: 1,
  polygonVersion: 1,
  hysteresisVersion: 1,
  configFlagVersion: 1,
  shadowSessionLimit: 5,
  shadowIdleTimeoutMs: 5 * 60_000,
  arrivalHintDedupWindowSeconds: 30,
  arrivalHintExpiryHours: 24,
  geofenceToleranceMeters: 50,
  geofenceHysteresisSeconds: 30,
  tieBreakerBufferMeters: 25,
  bootstrapAbandonedAfterMinutes: 60,
  softGraceSeconds: 120,
  hardGraceSeconds: 10,
  advisoryLockMaxWaitMs: 5_000,
  revocationReasonSchemaVersion: 1,
  retryPolicy: Object.freeze({
    command_accept: { maxAttempts: 3, baseSeconds: 1, jitterRatio: 0.25 },
    status_update: { maxAttempts: 3, baseSeconds: 1, jitterRatio: 0.25 },
    arrival_hint: { maxAttempts: 5, baseSeconds: 2, jitterRatio: 0.25 },
    manifest_capture: { maxAttempts: 5, baseSeconds: 5, jitterRatio: 0.25 },
    multipart_upload: { maxAttempts: 5, baseSeconds: 5, jitterRatio: 0.25 },
  }),
  capabilityFlags: Object.freeze({
    enableChunkChecksums: false,
    enableDynamicBackpressure: false,
    enableRuntimeStrictValidator: false,
    enableAtomicConfigLockCoordination: false,
    enableArtifactContendedShadowCircuitBreaker: false,
  }),
});

@Controller('config')
@UseGuards(JwtGuard)
export class ConfigClientController {
  @Get('client')
  get(@CurrentOperator() _op: OperatorContext): ClientConfig {
    // Tenancy resolution lives here for future per-company overrides.
    return PILOT_CONFIG;
  }
}
