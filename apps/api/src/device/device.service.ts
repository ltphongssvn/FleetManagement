// apps/api/src/device/device.service.ts
// Device session issuance + revocation per Frozen Stack PDF "Session/revocation".
// Enforces: one mutating session per (operator_id, surface); revoked_at authoritative.
//
// Race-condition safety:
// - Blind INSERT, catch Postgres 23505 (unique_violation) on partial unique index
// - DB-level unique partial index device_session_one_mutating_per_operator_surface_uq
//   is the sole authority; service translates DB errors to HTTP semantics
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  SESSION_MODES,
  SessionSurfaceSchema,
  SessionModeSchema,
  RevocationReasonSchema,
  type RevocationReason,
  type SessionMode,
  type SessionSurface,
} from '@fleet/domain';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { deviceRegistry, deviceSession, type DeviceSession } from '../database/schema/device.js';
import {
  SessionAlreadyActiveError,
  SessionInsertFailedError,
  SessionNotFoundError,
} from './device.errors.js';

import { isPgUniqueViolationOnConstraintInChain } from '../common/pg-errors.js';

export interface IssueSessionInput {
  readonly deviceId: string;
  readonly operatorId: string;
  readonly surface: SessionSurface;
  readonly sessionMode: SessionMode;
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
}

@Injectable()
export class DeviceService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}

  /**
   * Issue a new device_session. Blind insert; rely on DB unique partial index
   * to reject duplicate mutating sessions. Catches Postgres 23505 and translates
   * to ConflictException.
   */
  async issueSession(input: IssueSessionInput): Promise<DeviceSession> {
    SessionSurfaceSchema.parse(input.surface);
    SessionModeSchema.parse(input.sessionMode);

    try {
      const [row] = await this.db
        .insert(deviceSession)
        .values({
          deviceId: input.deviceId,
          operatorId: input.operatorId,
          surface: input.surface,
          sessionMode: input.sessionMode,
          companyId: input.companyId,
          businessUnitId: input.businessUnitId,
          depotId: input.depotId,
          legalEntityId: input.legalEntityId,
        })
        .returning();
      if (!row) throw new SessionInsertFailedError();
      return row;
    } catch (err) {
      if (
        isPgUniqueViolationOnConstraintInChain(
          err,
          'device_session_one_mutating_per_operator_surface_uq',
        )
      ) {
        throw new ConflictException(
          new SessionAlreadyActiveError(input.operatorId, input.surface).message,
        );
      }
      throw err;
    }
  }

  /** Revoke a session by id. Idempotent — re-revoking is a no-op. */
  async revokeSession(deviceSessionId: string, reason: RevocationReason): Promise<DeviceSession> {
    RevocationReasonSchema.parse(reason);
    const [row] = await this.db
      .update(deviceSession)
      .set({ revokedAt: new Date(), revocationReason: reason })
      .where(
        and(eq(deviceSession.deviceSessionId, deviceSessionId), isNull(deviceSession.revokedAt)),
      )
      .returning();
    if (!row) {
      const [existing] = await this.db
        .select()
        .from(deviceSession)
        .where(eq(deviceSession.deviceSessionId, deviceSessionId))
        .limit(1);
      if (!existing) {
        throw new NotFoundException(new SessionNotFoundError(deviceSessionId).message);
      }
      return existing;
    }
    return row;
  }

  /** Lookup active session for guard fast-path. */
  async findActiveSession(deviceSessionId: string): Promise<DeviceSession | null> {
    const [row] = await this.db
      .select()
      .from(deviceSession)
      .where(
        and(eq(deviceSession.deviceSessionId, deviceSessionId), isNull(deviceSession.revokedAt)),
      )
      .limit(1);
    return row ?? null;
  }

  /** Surface SESSION_MODES for callers (e.g. validation layers). */
  getSupportedModes(): readonly SessionMode[] {
    return SESSION_MODES;
  }

  /** Verify device exists in registry before session issue. */
  async deviceExists(deviceId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: deviceRegistry.deviceId })
      .from(deviceRegistry)
      .where(eq(deviceRegistry.deviceId, deviceId))
      .limit(1);
    return row !== undefined;
  }
}
